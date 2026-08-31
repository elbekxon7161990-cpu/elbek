import { Inject, Injectable } from '@nestjs/common';
import type { DraftRepository, TransactionExtractionCandidate } from '@afa/domain';
import { DRAFT_REPOSITORY } from '@afa/domain';

import { ProcessConversationEventUseCase } from './process-conversation-event.use-case';

export type OcrDraftCallbackAction = 'confirm' | 'edit' | 'cancel';

export interface ParsedOcrDraftCallback {
  action: OcrDraftCallbackAction;
  draftId: string;
}

/**
 * TASK-AI-006 — `ocrdraft_<action>:<draftId>`, a deliberately separate
 * namespace from `RouteCallbackQueryUseCase`'s own `<action>:<id>[:<field>]`
 * scheme (mirroring the existing `loan_wizard_`/`search_`/`delacct_`
 * precedent in `telegram-bot.service.ts`). No financial data, ever — same
 * rule every other callback_data scheme in this codebase already follows.
 */
export function parseOcrDraftCallbackData(raw: string): ParsedOcrDraftCallback | null {
  const [prefixedAction, draftId] = raw.split(':');
  if (!draftId || !prefixedAction?.startsWith('ocrdraft_')) {
    return null;
  }
  const action = prefixedAction.slice('ocrdraft_'.length);
  if (action !== 'confirm' && action !== 'edit' && action !== 'cancel') {
    return null;
  }
  return { action, draftId };
}

export interface OcrDraftMalformedOutcome {
  kind: 'malformed';
}

/** Covers both "no such draft" and "belongs to a different user" — never distinguished to the caller, so a cross-user probe learns nothing about whether the id exists at all. */
export interface OcrDraftNotFoundOutcome {
  kind: 'not_found';
}

export interface OcrDraftCancelledOutcome {
  kind: 'cancelled';
}

/** The draft was already resolved (completed/abandoned) by an earlier tap — idempotent no-op, never a duplicate side effect. */
export interface OcrDraftAlreadyResolvedOutcome {
  kind: 'already_resolved';
}

export interface OcrDraftConfirmedOutcome {
  kind: 'confirmed';
  transactionId: string;
  candidate: TransactionExtractionCandidate;
}

/** The commit succeeded and landed in `AWAITING_CONFIRMATION` with real, confidence-derived flagged fields — the caller sends the EXISTING post-commit confirmation card (`renderConfirmationMessage`/`buildConfirmationKeyboard`), unlocking the already-built Edit/Undo flow for this now-real transaction. */
export interface OcrDraftEditReadyOutcome {
  kind: 'edit_ready';
  transactionId: string;
  candidate: TransactionExtractionCandidate;
  flaggedFields: readonly string[];
}

export interface OcrDraftCommitFailedOutcome {
  kind: 'commit_failed';
  reason: string;
}

/** The rare case: the user's global `conversation_state` was not `IDLE` at the exact moment of the tap (a genuinely concurrent, unrelated flow) — `CANDIDATE_RESOLVED`'s own guard only fires from IDLE. No commit was attempted; safe to ask the user to retry. */
export interface OcrDraftRetryOutcome {
  kind: 'retry';
}

export type RouteOcrDraftCallbackOutcome =
  | OcrDraftMalformedOutcome
  | OcrDraftNotFoundOutcome
  | OcrDraftCancelledOutcome
  | OcrDraftAlreadyResolvedOutcome
  | OcrDraftConfirmedOutcome
  | OcrDraftEditReadyOutcome
  | OcrDraftCommitFailedOutcome
  | OcrDraftRetryOutcome;

export interface RouteOcrDraftCallbackInput {
  userId: string;
  callbackData: string;
}

/**
 * TASK-AI-006 — the OCR draft review card's Confirm/Edit/Cancel handler.
 * Deliberately does NOT reuse `RouteCallbackQueryUseCase` (whose `confirm`
 * action assumes the transaction is ALREADY committed by the time
 * `AWAITING_CONFIRMATION` exists — the opposite of what an OCR draft needs:
 * commit-on-tap, not acknowledge-an-already-done-commit) and does NOT read
 * or write `conversation_state` before calling `ProcessConversationEventUseCase`
 * — an async OCR result can arrive minutes after the photo was sent, while
 * the user's single per-user `conversation_state` slot may legitimately be
 * mid an unrelated text conversation; writing into it pre-emptively would
 * risk clobbering that unrelated flow.
 *
 * Confirm/Edit both reuse `ProcessConversationEventUseCase`'s existing
 * `CANDIDATE_RESOLVED` guard-table entry point unchanged — Confirm passes
 * `classification: 'auto_commit'` (commits, stays IDLE, no follow-up
 * keyboard); Edit passes `classification: 'flagged_review'` (commits,
 * lands in `AWAITING_CONFIRMATION` with `deriveFlaggedFields`'s own real,
 * confidence-derived field list — never a hardcoded "all fields" guess),
 * which is exactly how the guard table computes the flagged set for every
 * other flagged_review candidate. `TransactionCommitPort`'s own per-draftId
 * idempotency lock (already relied on everywhere else) makes a duplicate
 * Confirm tap safe with zero new code; a duplicate Edit tap after the first
 * one already moved state to `AWAITING_CONFIRMATION` is correctly rejected
 * by the guard table itself (no longer IDLE) and surfaces as `'retry'`,
 * never a second commit.
 */
@Injectable()
export class RouteOcrDraftCallbackUseCase {
  constructor(
    @Inject(DRAFT_REPOSITORY) private readonly draftRepository: DraftRepository,
    private readonly processConversationEvent: ProcessConversationEventUseCase,
  ) {}

  async execute(input: RouteOcrDraftCallbackInput): Promise<RouteOcrDraftCallbackOutcome> {
    const parsed = parseOcrDraftCallbackData(input.callbackData);
    if (!parsed) {
      return { kind: 'malformed' };
    }

    const draft = await this.draftRepository.findById(parsed.draftId);
    if (draft === null || draft.userId !== input.userId) {
      return { kind: 'not_found' };
    }

    if (parsed.action === 'cancel') {
      if (draft.status !== 'pending') {
        return { kind: 'already_resolved' };
      }
      await this.draftRepository.updateStatus(parsed.draftId, { status: 'abandoned' });
      return { kind: 'cancelled' };
    }

    const classification = parsed.action === 'edit' ? 'flagged_review' : 'auto_commit';
    const outcome = await this.processConversationEvent.execute(input.userId, {
      type: 'CANDIDATE_RESOLVED',
      classification,
      candidate: draft.partialData,
      missingField: null,
      clarificationQuestion: null,
      draftId: parsed.draftId,
      originalText: draft.originalText,
      sourceType: draft.sourceType,
    });

    if (outcome.status === 'rejected' || outcome.status === 'concurrency_conflict') {
      return { kind: 'retry' };
    }
    if (outcome.status === 'commit_failed') {
      return { kind: 'commit_failed', reason: outcome.reason };
    }
    // outcome.status === 'transitioned'
    if (outcome.transactionId === null) {
      // Structurally unreachable for CANDIDATE_RESOLVED (both auto_commit
      // and flagged_review always set commitRequested: true), but handled
      // rather than asserted — a defensive `retry` beats a thrown error.
      return { kind: 'retry' };
    }
    if (parsed.action === 'edit') {
      return {
        kind: 'edit_ready',
        transactionId: outcome.transactionId,
        candidate: draft.partialData,
        flaggedFields: outcome.flaggedFields,
      };
    }
    return { kind: 'confirmed', transactionId: outcome.transactionId, candidate: draft.partialData };
  }
}
