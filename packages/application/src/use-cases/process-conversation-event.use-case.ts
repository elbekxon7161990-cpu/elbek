import { Inject, Injectable } from '@nestjs/common';
import type {
  ConversationContextPayload,
  ConversationEvent,
  ConversationState,
  ConversationStateRecord,
  ConversationStateRepository,
  DraftRepository,
  TransactionCommitPort,
} from '@afa/domain';
import {
  CONVERSATION_STATE_REPOSITORY,
  DEFAULT_PENDING_STATE_TTL_SECONDS,
  DRAFT_REPOSITORY,
  TRANSACTION_COMMIT_PORT,
  createIdleState,
  evaluateConversationTransition,
  isConversationStateExpired,
} from '@afa/domain';

import { TransactionAlreadyDeletedError } from '../errors/transaction-already-deleted.error';
import { DeleteTransactionUseCase } from './delete-transaction.use-case';

/** §5.15.2 doesn't give AWAITING_CONFIRMATION its own explicit TTL row — the closest stated number is FR-CE-013's 24-hour Edit/Undo affordance window, reused here as this state's own TTL (a reasoned inference, not a directly-tabled value; see this task's final report). */
const AWAITING_CONFIRMATION_TTL_SECONDS = 24 * 60 * 60;
const MAX_CAS_RETRIES = 3;

export interface TransitionedOutcome {
  status: 'transitioned';
  requirementId: string;
  previousState: ConversationState;
  nextState: ConversationState;
  transactionId: string | null;
  fallbackToMiniForm: boolean;
  /**
   * TASK-BOT-004 — the guard table's own `flaggedFieldsIfCommitting`
   * (FR-CE-012), passed through so the caller (`TelegramBotService`'s
   * Confirmation Renderer) can build the confirmation message/inline
   * keyboard without recomputing confidence-derived flagging itself. Empty
   * whenever no commit happened (or nothing was flagged).
   */
  flaggedFields: readonly string[];
}

export interface RejectedOutcome {
  status: 'rejected';
  requirementId: string | null;
  reason: string;
}

/** BR-CE-006 — every retry against a concurrently-changed record was exhausted (or the state changed underneath us into something this evaluation no longer applies to); the caller should surface a graceful "please try again" rather than silently dropping the event or clobbering unrelated state. */
export interface ConcurrencyConflictOutcome {
  status: 'concurrency_conflict';
}

/** TASK-FIN-REAL-001 — the guard table allowed this transition (`commitRequested: true`), but the real `TransactionCommitPort` rejected or failed the commit itself (invalid category/currency/amount, an unsupported intent, a database failure, ...). No state write is attempted — same "rejected confirmation produces zero transaction writes" symmetry as an outright-rejected transition, since the guard table's promised transition assumed a successful commit that never happened. */
export interface CommitFailedOutcome {
  status: 'commit_failed';
  reason: string;
}

export type ProcessConversationEventOutcome =
  TransitionedOutcome | RejectedOutcome | ConcurrencyConflictOutcome | CommitFailedOutcome;

function ttlSecondsFor(state: ConversationState): number | null {
  switch (state) {
    case 'IDLE':
      return null;
    case 'AWAITING_CONFIRMATION':
      return AWAITING_CONFIRMATION_TTL_SECONDS;
    default:
      return DEFAULT_PENDING_STATE_TTL_SECONDS;
  }
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

/**
 * TASK-BOT-002 — the application-layer orchestration around the pure
 * `evaluateConversationTransition` (§5.13's Transition Evaluator): reads
 * current state (§5.12.1 State Reader), enforces read-time expiry
 * (§5.19.2), evaluates the transition, performs the commit side effect
 * the evaluator only *requests* (§5.12.2's "hand off to Domain Service
 * Layer" arrow) via the injected `TransactionCommitPort`, then writes the
 * new state atomically (§5.16.2 BR-CE-006's compare-and-set, retried on
 * conflict per "the losing writer's attempt is retried against the
 * now-current state").
 *
 * The commit side effect (when `commitRequested` is true) is performed
 * exactly once per `execute()` call, deliberately OUTSIDE the CAS retry
 * loop — retrying a lost compare-and-set must never re-invoke
 * `TransactionCommitPort.commit`, or a losing race on the state *write*
 * would silently create a second, duplicate financial transaction for the
 * same candidate. The retry loop below only re-attempts the write, re-
 * reading the current version each time; if the underlying state has
 * changed to something other than what this evaluation was based on
 * (a genuinely different concurrent event for the same user — a case
 * §5.16.3/5.16.4 assigns to upstream per-user FIFO ordering, not this
 * task), it gives up and reports `concurrency_conflict` rather than
 * guessing.
 *
 * User isolation (§5.18.2, BR-CE-002) is structural, not policy: every
 * repository call is scoped by `userId`, and this use case never accepts
 * or reads any other user's key — there is no code path here by which one
 * user's event could read or mutate another user's `conversation_state`.
 */
@Injectable()
export class ProcessConversationEventUseCase {
  constructor(
    @Inject(CONVERSATION_STATE_REPOSITORY)
    private readonly stateRepository: ConversationStateRepository,
    @Inject(TRANSACTION_COMMIT_PORT) private readonly transactionCommitPort: TransactionCommitPort,
    @Inject(DRAFT_REPOSITORY) private readonly draftRepository: DraftRepository,
    private readonly deleteTransaction: DeleteTransactionUseCase,
  ) {}

  async execute(
    userId: string,
    event: ConversationEvent,
  ): Promise<ProcessConversationEventOutcome> {
    const now = new Date().toISOString();
    const existing = await this.stateRepository.get(userId);
    const record = existing ?? createIdleState(userId, now);
    const expired = existing !== null && isConversationStateExpired(existing, now);
    const effectiveState: ConversationState = expired ? 'IDLE' : record.state;
    const effectiveContextPayload = expired ? null : record.contextPayload;

    const outcome = evaluateConversationTransition(effectiveState, effectiveContextPayload, event);

    if (!outcome.allowed) {
      return { status: 'rejected', requirementId: outcome.requirementId, reason: outcome.reason };
    }

    let transactionId: string | null = null;
    let nextContextPayload: ConversationContextPayload = outcome.nextContextPayload;

    if (outcome.commitRequested && event.type === 'CANDIDATE_RESOLVED') {
      let commitResult;
      try {
        commitResult = await this.transactionCommitPort.commit({
          userId,
          candidate: event.candidate,
          draftId: event.draftId,
          originalText: event.originalText,
          sourceType: event.sourceType,
        });
      } catch (error) {
        return {
          status: 'commit_failed',
          reason: error instanceof Error ? error.message : 'Unknown commit failure',
        };
      }
      transactionId = commitResult.transactionId;
      // TASK-BOT-004 (§5.5) — the draft this candidate came from is
      // resolved the instant its commit succeeds, for both auto_commit
      // (IDLE) and flagged_review (AWAITING_CONFIRMATION); an Undo later
      // (see the CANCELLATION handling below) reverts this back to
      // 'abandoned'.
      await this.draftRepository.updateStatus(event.draftId, {
        status: 'completed',
        resolvedTransactionId: transactionId,
      });
      if (outcome.nextState === 'AWAITING_CONFIRMATION') {
        nextContextPayload = {
          transactionId,
          draftId: event.draftId,
          flaggedFields: outcome.flaggedFieldsIfCommitting,
        };
      }
    }

    // TASK-BOT-004 (FR-CE-013 "Undo", §5.5's "discarded" semantics) — a
    // CANCELLATION the guard table above already allowed needs one more
    // side effect the pure evaluator deliberately doesn't know about: which
    // *draft* this cancels, and — only when cancelling out of
    // AWAITING_CONFIRMATION — reversing the transaction FR-CE-044 already
    // committed by the time that state was entered. Reads the SAME
    // `effectiveContextPayload` already resolved above; does not touch
    // `evaluateConversationTransition`'s guard table or its CANCELLATION
    // branch, which remains a plain "any pending state -> IDLE" (FR-CE-047).
    if (event.type === 'CANCELLATION' && effectiveContextPayload !== null) {
      if ('transactionId' in effectiveContextPayload) {
        // Cancelling out of AWAITING_CONFIRMATION == Undo: the transaction
        // is already committed (FR-CE-044) and must be genuinely reversed,
        // not just dismissed.
        try {
          await this.deleteTransaction.execute({
            transactionId: effectiveContextPayload.transactionId,
            userId,
            actor: 'undo',
          });
        } catch (error) {
          // A duplicate Undo (two taps racing, or a retry) must be safe —
          // the transaction is already gone, which is the outcome Undo
          // wanted anyway.
          if (!(error instanceof TransactionAlreadyDeletedError)) {
            throw error;
          }
        }
        await this.draftRepository.updateStatus(effectiveContextPayload.draftId, {
          status: 'abandoned',
        });
      } else if ('draftId' in effectiveContextPayload) {
        // Cancelling out of AWAITING_CLARIFICATION — nothing was ever
        // committed (FR-CE-041), so there is nothing to reverse; the draft
        // itself is simply discarded (§5.6's "pending draft ... is
        // discarded").
        await this.draftRepository.updateStatus(effectiveContextPayload.draftId, {
          status: 'abandoned',
        });
      }
      // AWAITING_EDIT_VALUE's context (`targetId`/`targetField`) matches
      // neither branch above — cancelling an in-progress edit leaves the
      // original, already-valid transaction and its already-resolved draft
      // untouched (§5.6 doesn't ask an edit-cancel to undo the edit's
      // *subject*, only the edit attempt itself).
    }

    const createdAt = expired || !existing ? now : record.createdAt;
    const expiresAt = (() => {
      const ttl = ttlSecondsFor(outcome.nextState);
      return ttl === null ? null : addSeconds(now, ttl);
    })();

    let expectedVersion = record.version;
    let baseState = effectiveState;

    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
      const nextRecord: ConversationStateRecord = {
        userId,
        state: outcome.nextState,
        contextPayload: nextContextPayload,
        createdAt,
        expiresAt,
        version: expectedVersion + 1,
      };

      const written = await this.stateRepository.compareAndSet(userId, expectedVersion, nextRecord);
      if (written) {
        return {
          status: 'transitioned',
          requirementId: outcome.requirementId,
          previousState: effectiveState,
          nextState: outcome.nextState,
          transactionId,
          fallbackToMiniForm: outcome.fallbackToMiniForm,
          flaggedFields: outcome.flaggedFieldsIfCommitting,
        };
      }

      const fresh = await this.stateRepository.get(userId);
      const freshEffectiveState: ConversationState =
        fresh === null ? 'IDLE' : isConversationStateExpired(fresh, now) ? 'IDLE' : fresh.state;
      if (freshEffectiveState !== baseState) {
        // The record moved to a state this evaluation didn't account for — a
        // genuinely different concurrent transition, not a benign lost race
        // (a fresh user with no record at all is still consistently IDLE,
        // and is NOT treated as a conflict here). Never blindly overwrite a
        // genuinely different state, especially after a commit has already
        // happened (see this class's doc comment).
        return { status: 'concurrency_conflict' };
      }
      expectedVersion = fresh?.version ?? 0;
      baseState = freshEffectiveState;
    }

    return { status: 'concurrency_conflict' };
  }
}
