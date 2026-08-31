import { Inject, Injectable } from '@nestjs/common';
import type {
  AwaitingConfirmationContext,
  AwaitingMultiItemReviewContext,
  ConversationContextPayload,
  ConversationState,
  ConversationStateRepository,
  DraftRepository,
  TransactionCommitPort,
  TransactionExtractionCandidate,
} from '@afa/domain';
import {
  CONVERSATION_STATE_REPOSITORY,
  DRAFT_REPOSITORY,
  TRANSACTION_COMMIT_PORT,
  isConversationStateExpired,
} from '@afa/domain';

import { ProcessConversationEventUseCase } from './process-conversation-event.use-case';
import type { ProcessConversationEventOutcome } from './process-conversation-event.use-case';

export type CallbackAction =
  'confirm' | 'edit' | 'cancel' | 'undo' | 'batch_confirm' | 'batch_skip' | 'batch_commit_high';

export interface ParsedCallbackData {
  action: CallbackAction;
  transactionId: string;
  targetField: string | null;
}

/**
 * TASK-BOT-001's own callback_data scheme (`<action>:<transactionId>[:<field>]`)
 * — no earlier task defines one (TASK-BOT-004's Confirmation Renderer, which
 * will actually emit these buttons, doesn't exist yet), so this is a new,
 * minimal, forward-compatible format this task introduces; whichever task
 * builds the renderer must emit callback_data in this shape.
 *
 * TASK-BOT-004 adds `undo` (FR-CE-013) — deliberately a distinct action from
 * the pre-existing `cancel`, not a reuse of it: `cancel` is also driven by
 * plain-text cancellation phrases with no specific transaction in mind (see
 * `RouteCallbackQueryUseCase.execute`'s early `cancel` branch, which never
 * checks `transactionId` against the currently pending one), whereas `undo`
 * is exclusively button-driven against one specific, already-rendered
 * confirmation message and MUST be ownership/staleness-checked against that
 * message's encoded `transactionId` before anything is reversed — the same
 * check `edit` already goes through, below.
 *
 * TASK-BOT-006 adds `batch_confirm`/`batch_skip`/`batch_commit_high` —
 * same minimal shape, `transactionId`'s slot reused to carry a
 * `transaction_drafts.id` (`batch_confirm`/`batch_skip`) or a `batchId`
 * (`batch_commit_high`); never a field beyond an id, same "no financial
 * data in callback_data" rule the existing actions already follow.
 */
export function parseCallbackData(raw: string): ParsedCallbackData | null {
  const parts = raw.split(':');
  const [action, transactionId, targetField] = parts;
  if (
    action !== 'confirm' &&
    action !== 'edit' &&
    action !== 'cancel' &&
    action !== 'undo' &&
    action !== 'batch_confirm' &&
    action !== 'batch_skip' &&
    action !== 'batch_commit_high'
  ) {
    return null;
  }
  if (!transactionId) {
    return null;
  }
  if (action === 'edit' && !targetField) {
    return null;
  }
  return { action, transactionId, targetField: targetField ?? null };
}

export interface RouteCallbackQueryInput {
  userId: string;
  callbackData: string;
  currentDateTime: string;
}

export interface MalformedCallbackOutcome {
  kind: 'malformed';
}

/** BR-BOT-002 — the callback references a draft/transaction that no longer matches the currently pending one (already handled by another path, or expired). */
export interface StaleCallbackOutcome {
  kind: 'stale';
}

/** FR-CE-044's model: the transaction is already committed by the time AWAITING_CONFIRMATION is entered, so "Confirm" has no guard-table transition — just dismiss the prompt. */
export interface AcknowledgedOutcome {
  kind: 'acknowledged';
}

export interface EditRequestedOutcome {
  kind: 'edit_requested';
  processEventOutcome: ProcessConversationEventOutcome;
}

export interface CallbackCancelledOutcome {
  kind: 'cancelled';
  processEventOutcome: ProcessConversationEventOutcome;
}

/** TASK-BOT-004 (FR-CE-013) — the ownership/staleness-checked "Undo" tap; `processEventOutcome` reflects the same underlying CANCELLATION transition `cancelled` produces, but the caller distinguishes this outcome kind to send Undo-specific reply text. */
export interface CallbackUndoneOutcome {
  kind: 'undone';
  processEventOutcome: ProcessConversationEventOutcome;
}

/** TASK-BOT-006 (FR-CE-032) — the item at the current review position was committed (Confirm). `nextCandidate`/`nextPosition` are `null` when this was the last low-confidence item (review complete, per FR-CE-033). */
export interface BatchItemConfirmedOutcome {
  kind: 'batch_item_confirmed';
  processEventOutcome: ProcessConversationEventOutcome;
  transactionId: string;
  nextCandidate: TransactionExtractionCandidate | null;
  /** 1-based, for "Item X of Y" display. */
  nextPosition: number | null;
  /** The draft id for `nextCandidate` — the caller (`TelegramBotService`) needs it to build the next item's Confirm/Skip callback_data. `null` exactly when `nextCandidate` is `null`. */
  nextDraftId: string | null;
  totalLowConfidence: number;
}

/** TASK-BOT-006 — the item at the current review position was left uncommitted (Skip, per this task's ambiguity-point-C resolution) and review advanced. Its draft remains `pending`, recoverable via `/drafts`. */
export interface BatchItemSkippedOutcome {
  kind: 'batch_item_skipped';
  processEventOutcome: ProcessConversationEventOutcome;
  nextCandidate: TransactionExtractionCandidate | null;
  nextPosition: number | null;
  /** See `BatchItemConfirmedOutcome.nextDraftId`. */
  nextDraftId: string | null;
  totalLowConfidence: number;
}

/** Mirrors `ClarificationCommitFailedOutcome`/`InterruptionCommitFailedOutcome` — a Confirm tap's real `TransactionCommitPort` call was rejected. Conversation state/draft are left untouched; the same item is still current. */
export interface BatchCommitFailedOutcome {
  kind: 'batch_commit_failed';
  reason: string;
}

/**
 * TASK-BOT-006 (FR-CE-031) — the "Import all N confident ones now" tap.
 * Only *the guard-table write* is state-independent — it never touches
 * `conversation_state` itself, so it can be tapped at any point WHILE still
 * `AWAITING_MULTI_ITEM_REVIEW` without disturbing the low-confidence
 * pagination. It is NOT reachable once review completes and state has
 * already returned to IDLE (FR-CE-033): `highConfidenceDraftIds` is only
 * known via the live `AwaitingMultiItemReviewContext`, and
 * `TransactionDraftRecord` carries no `batchId` of its own to recover it
 * from afterward. In that window the drafts remain `pending` and are still
 * fully recoverable via `/drafts`, just not through this specific button —
 * a real, identified limitation (not a silent gap), see this task's final
 * report. Each item is committed independently; already-`completed` drafts
 * (a duplicate tap while still reachable) are silently skipped, not
 * re-committed.
 */
export interface BatchHighConfidenceCommittedOutcome {
  kind: 'batch_high_confidence_committed';
  committedCount: number;
  failedCount: number;
  transactionIds: readonly string[];
}

export type RouteCallbackQueryOutcome =
  | MalformedCallbackOutcome
  | StaleCallbackOutcome
  | AcknowledgedOutcome
  | EditRequestedOutcome
  | CallbackCancelledOutcome
  | CallbackUndoneOutcome
  | BatchItemConfirmedOutcome
  | BatchItemSkippedOutcome
  | BatchCommitFailedOutcome
  | BatchHighConfidenceCommittedOutcome;

/**
 * TASK-BOT-001 (Chapter 19 §19.2.2's "Callback query -> Conversation
 * Engine, resolved against pending state" row; §7.2.6's sequence diagram —
 * "parse callback_data -> identify target draft/transaction ID + action" ->
 * "Conversation Engine: validate current state allows this action").
 *
 * The staleness check here (BR-BOT-002) is a courtesy early-exit with a
 * clearer message than a raw guard-table rejection would give — the guard
 * table (`evaluateConversationTransition`) is still the sole real authority
 * and would reject an out-of-context `EDIT_REQUESTED`/`CANCELLATION` event
 * on its own regardless of whether this check runs.
 */
@Injectable()
export class RouteCallbackQueryUseCase {
  constructor(
    @Inject(CONVERSATION_STATE_REPOSITORY)
    private readonly stateRepository: ConversationStateRepository,
    @Inject(DRAFT_REPOSITORY)
    private readonly draftRepository: DraftRepository,
    @Inject(TRANSACTION_COMMIT_PORT)
    private readonly transactionCommitPort: TransactionCommitPort,
    private readonly processConversationEvent: ProcessConversationEventUseCase,
  ) {}

  async execute(input: RouteCallbackQueryInput): Promise<RouteCallbackQueryOutcome> {
    const parsed = parseCallbackData(input.callbackData);
    if (!parsed) {
      return { kind: 'malformed' };
    }

    if (parsed.action === 'cancel') {
      const processEventOutcome = await this.processConversationEvent.execute(input.userId, {
        type: 'CANCELLATION',
      });
      return { kind: 'cancelled', processEventOutcome };
    }

    const record = await this.stateRepository.get(input.userId);
    const expired = record !== null && isConversationStateExpired(record, input.currentDateTime);
    const effectiveState: ConversationState = record === null || expired ? 'IDLE' : record.state;
    const effectiveContextPayload = record === null || expired ? null : record.contextPayload;

    if (
      parsed.action === 'batch_confirm' ||
      parsed.action === 'batch_skip' ||
      parsed.action === 'batch_commit_high'
    ) {
      return this.executeBatchAction(input, parsed, effectiveState, effectiveContextPayload);
    }

    if (
      effectiveState !== 'AWAITING_CONFIRMATION' ||
      effectiveContextPayload === null ||
      !('transactionId' in effectiveContextPayload)
    ) {
      return { kind: 'stale' };
    }
    const context = effectiveContextPayload as AwaitingConfirmationContext;
    if (context.transactionId !== parsed.transactionId) {
      return { kind: 'stale' };
    }

    if (parsed.action === 'confirm') {
      return { kind: 'acknowledged' };
    }

    if (parsed.action === 'undo') {
      // Ownership/staleness already verified above (context.transactionId
      // === parsed.transactionId) — this CANCELLATION is guaranteed to
      // reverse exactly the transaction this specific button referred to,
      // via ProcessConversationEventUseCase's own Undo side effect (see its
      // doc comment), never a different, more-recently-pending one.
      const processEventOutcome = await this.processConversationEvent.execute(input.userId, {
        type: 'CANCELLATION',
      });
      return { kind: 'undone', processEventOutcome };
    }

    // parsed.action === 'edit'
    const processEventOutcome = await this.processConversationEvent.execute(input.userId, {
      type: 'EDIT_REQUESTED',
      targetField: parsed.targetField!,
    });
    return { kind: 'edit_requested', processEventOutcome };
  }

  /**
   * TASK-BOT-006 — `batch_confirm`/`batch_skip` (FR-CE-032) and
   * `batch_commit_high` (FR-CE-031). Ownership is always resolved
   * server-side against the CURRENT `AwaitingMultiItemReviewContext`
   * (`context.lowConfidenceDraftIds[context.currentIndex]` for the two
   * per-item actions, `context.batchId` for the batch-commit one) — the
   * `callbackData`-supplied id is only ever compared against it, never
   * trusted alone, same rule `undo`/`edit` already follow.
   */
  private async executeBatchAction(
    input: RouteCallbackQueryInput,
    parsed: ParsedCallbackData,
    effectiveState: ConversationState,
    effectiveContextPayload: ConversationContextPayload,
  ): Promise<RouteCallbackQueryOutcome> {
    if (
      effectiveState !== 'AWAITING_MULTI_ITEM_REVIEW' ||
      effectiveContextPayload === null ||
      !('lowConfidenceDraftIds' in effectiveContextPayload)
    ) {
      return { kind: 'stale' };
    }
    const context = effectiveContextPayload as AwaitingMultiItemReviewContext;

    if (parsed.action === 'batch_commit_high') {
      if (context.batchId !== parsed.transactionId) {
        return { kind: 'stale' };
      }
      return this.commitHighConfidenceBatch(input.userId, context.highConfidenceDraftIds);
    }

    // batch_confirm / batch_skip — must target the item currently at
    // context.currentIndex specifically, never an arbitrary/stale one.
    const currentDraftId = context.lowConfidenceDraftIds[context.currentIndex];
    if (currentDraftId === undefined || currentDraftId !== parsed.transactionId) {
      return { kind: 'stale' };
    }

    let transactionId: string | null = null;
    if (parsed.action === 'batch_confirm') {
      const draft = await this.draftRepository.findById(currentDraftId);
      if (draft === null) {
        return { kind: 'stale' };
      }
      try {
        const result = await this.transactionCommitPort.commit({
          userId: input.userId,
          candidate: draft.partialData,
          draftId: currentDraftId,
          originalText: draft.originalText,
          sourceType: draft.sourceType,
        });
        transactionId = result.transactionId;
        await this.draftRepository.updateStatus(currentDraftId, {
          status: 'completed',
          resolvedTransactionId: transactionId,
        });
      } catch (error) {
        return {
          kind: 'batch_commit_failed',
          reason: error instanceof Error ? error.message : 'Unknown commit failure',
        };
      }
    }
    // batch_skip — no commit; the draft stays 'pending' (this task's
    // ambiguity-point-C resolution — see final report).

    const processEventOutcome = await this.processConversationEvent.execute(input.userId, {
      type: 'BATCH_ITEM_REVIEWED',
    });

    const nextIndex = context.currentIndex + 1;
    const nextDraftIdCandidate = context.lowConfidenceDraftIds[nextIndex];
    const nextDraft =
      nextDraftIdCandidate !== undefined
        ? await this.draftRepository.findById(nextDraftIdCandidate)
        : null;
    const nextCandidate: TransactionExtractionCandidate | null = nextDraft?.partialData ?? null;
    const nextPosition = nextCandidate !== null ? nextIndex + 1 : null;
    const nextDraftId = nextCandidate !== null ? nextDraftIdCandidate! : null;
    const totalLowConfidence = context.lowConfidenceDraftIds.length;

    if (parsed.action === 'batch_confirm') {
      return {
        kind: 'batch_item_confirmed',
        processEventOutcome,
        transactionId: transactionId!,
        nextCandidate,
        nextPosition,
        nextDraftId,
        totalLowConfidence,
      };
    }
    return {
      kind: 'batch_item_skipped',
      processEventOutcome,
      nextCandidate,
      nextPosition,
      nextDraftId,
      totalLowConfidence,
    };
  }

  /** FR-CE-031 — commits every still-`pending` high-confidence draft independently; already-`completed` ones (a duplicate tap) are silently skipped, not re-committed. */
  private async commitHighConfidenceBatch(
    userId: string,
    draftIds: readonly string[],
  ): Promise<RouteCallbackQueryOutcome> {
    let committedCount = 0;
    const transactionIds: string[] = [];
    for (const draftId of draftIds) {
      const draft = await this.draftRepository.findById(draftId);
      if (draft === null || draft.status !== 'pending') {
        continue;
      }
      try {
        const result = await this.transactionCommitPort.commit({
          userId,
          candidate: draft.partialData,
          draftId,
          originalText: draft.originalText,
          sourceType: draft.sourceType,
        });
        await this.draftRepository.updateStatus(draftId, {
          status: 'completed',
          resolvedTransactionId: result.transactionId,
        });
        transactionIds.push(result.transactionId);
        committedCount += 1;
      } catch {
        // Independent, single-row commits — one failure does not block the rest.
      }
    }
    return {
      kind: 'batch_high_confidence_committed',
      committedCount,
      failedCount: draftIds.length - committedCount,
      transactionIds,
    };
  }
}
