import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  AwaitingClarificationContext,
  AwaitingEditValueContext,
  CandidateGuardrailReport,
  ConversationState,
  ConversationStateRepository,
  DetectedLanguage,
  DraftRepository,
  TransactionCommitPort,
  TransactionEditableFields,
  TransactionExtractionCandidate,
} from '@afa/domain';
import {
  CONVERSATION_STATE_REPOSITORY,
  DRAFT_REPOSITORY,
  InvalidTransactionError,
  TRANSACTION_COMMIT_PORT,
  classifyInterruption,
  computeRequiredFields,
  generateClarificationQuestion,
  isCancellationPhrase,
  isConversationStateExpired,
  selectClarificationField,
} from '@afa/domain';

import { ApplicationError } from '../errors/application.error';
import { EditTransactionUseCase } from './edit-transaction.use-case';
import { ExtractTransactionCandidatesUseCase } from './extract-transaction-candidates.use-case';
import { ProcessConversationEventUseCase } from './process-conversation-event.use-case';
import type { ProcessConversationEventOutcome } from './process-conversation-event.use-case';

export interface RouteTextMessageInput {
  userId: string;
  text: string;
  currentDateTime: string;
  userDefaultCurrency: string;
  userRecentCategories: readonly string[];
}

export interface TextCancelledOutcome {
  kind: 'cancelled';
  processEventOutcome: ProcessConversationEventOutcome;
}

/** AI Processing Core could not classify the message at all (e.g. provider/schema failure). */
export interface ExtractionUnknownOutcome {
  kind: 'extraction_unknown';
  reason: string;
}

/** A valid, non-financial intent (small talk, a query, etc.) — no transaction candidate to route. */
export interface NoTransactionDetectedOutcome {
  kind: 'no_transaction_detected';
  /** TASK-BOT-008 (Chapter 4 §4.2.2) — this turn's detected language, threaded through wherever extraction actually ran (it did here), for the caller's `resolveReplyLanguage`. */
  detectedLanguage: DetectedLanguage;
}

/**
 * TASK-BOT-006 (§5.7, FR-CE-030/§5.13.2's degenerate case) — a compound
 * message (N >= 2 candidates, FR-AI-011) where EVERY candidate classified
 * `auto_commit`. Mirrors FR-CE-040's single-item "high confidence commits
 * immediately, stays IDLE" precedent applied N times — there is nothing to
 * review, so `AWAITING_MULTI_ITEM_REVIEW` is never entered at all (avoids a
 * state with no low-confidence items and no natural exit transition other
 * than cancellation or TTL). Each commit is independent (its own
 * single-row insert); a failure on one item does not block the others.
 */
export interface BatchAllHighConfidenceCommittedOutcome {
  kind: 'batch_all_high_confidence_committed';
  totalItems: number;
  committedCount: number;
  failedCount: number;
  transactionIds: readonly string[];
  /** TASK-BOT-008 — see `NoTransactionDetectedOutcome`'s own doc comment. */
  detectedLanguage: DetectedLanguage;
}

/**
 * TASK-BOT-006 (§5.7, FR-CE-030) — a compound message with at least one
 * non-`auto_commit` candidate started a real batch review
 * (`AWAITING_MULTI_ITEM_REVIEW`). Replaces the old, permanent
 * `multi_candidate_not_supported` rejection. Every candidate in the batch
 * already has its own `transaction_drafts` row by this point (§5.5);
 * `highConfidenceCount` items are offered as one optional batch-commit
 * (FR-CE-031, not yet committed); `lowConfidenceCandidates` are reviewed
 * one at a time (FR-CE-032) — the caller renders position 0 first.
 */
export interface BatchReviewStartedOutcome {
  kind: 'batch_review_started';
  processEventOutcome: ProcessConversationEventOutcome;
  batchId: string;
  totalItems: number;
  highConfidenceCount: number;
  lowConfidenceCandidates: readonly TransactionExtractionCandidate[];
  /** Parallel to `lowConfidenceCandidates` (same order, same index) — the caller (`TelegramBotService`) needs `lowConfidenceDraftIds[0]` to build the first item's Confirm/Skip callback_data (`batch_confirm:<draftId>`/`batch_skip:<draftId>`). */
  lowConfidenceDraftIds: readonly string[];
  /** TASK-BOT-008 — see `NoTransactionDetectedOutcome`'s own doc comment. */
  detectedLanguage: DetectedLanguage;
}

export interface CandidateProcessedOutcome {
  kind: 'candidate_processed';
  processEventOutcome: ProcessConversationEventOutcome;
  candidate: TransactionExtractionCandidate;
  /**
   * TASK-BOT-003 — the generated clarification question (Chapter 5 §5.3.2),
   * populated only when `processEventOutcome.nextState === 'AWAITING_CLARIFICATION'`;
   * `null` otherwise (auto-commit/flagged-review need no question). The
   * caller (`TelegramBotService`) sends this text instead of a generic
   * acknowledgment.
   */
  clarificationQuestion: string | null;
  /** TASK-BOT-008 — see `NoTransactionDetectedOutcome`'s own doc comment. */
  detectedLanguage: DetectedLanguage;
}

/**
 * TASK-BOT-003 — the answer did NOT resolve the pending field
 * (`fieldResolved: false` — see `ClarificationResolvedOutcome` below for
 * the resolved case, which TASK-BOT-002-FIX split out into its own kind
 * once it started carrying a real commit).
 */
export interface ClarificationProcessedOutcome {
  kind: 'clarification_processed';
  processEventOutcome: ProcessConversationEventOutcome;
  /**
   * TASK-BOT-003 — the re-ask's question text (BR-CE-003), populated when
   * the answer left the conversation in `AWAITING_CLARIFICATION` (still
   * unresolved, retry budget remains); `null` only when the retry budget is
   * exhausted (the caller uses `language` below with
   * `generateClarificationFallbackMessage` instead).
   */
  nextQuestion: string | null;
  /** TASK-BOT-003 — this turn's detected language (FR-CE-003), for the caller to pick the right `generateClarificationFallbackMessage` wording when `processEventOutcome.fallbackToMiniForm` is true. */
  language: DetectedLanguage;
}

/**
 * TASK-BOT-002-FIX (§5.2.3's state diagram: "AWAITING_CLARIFICATION -> IDLE:
 * user answers, record resolved and committed") — the pending field
 * resolved, the merged candidate (original draft + this turn's answer) was
 * committed exactly once, its draft marked `completed`, and conversation
 * state transitioned to IDLE. `candidate` is the merged, now-complete
 * record actually committed — never fabricated, always traceable to the
 * original draft's stored data plus this turn's real extraction.
 */
export interface ClarificationResolvedOutcome {
  kind: 'clarification_resolved';
  processEventOutcome: ProcessConversationEventOutcome;
  candidate: TransactionExtractionCandidate;
  transactionId: string;
  /** TASK-BOT-008 — see `NoTransactionDetectedOutcome`'s own doc comment. */
  detectedLanguage: DetectedLanguage;
}

/** Mirrors `InterruptionCommitFailedOutcome`/`ProcessConversationEventUseCase`'s `commit_failed` — the field resolved, but the real `TransactionCommitPort` rejected the merged candidate. The pending clarification (draft + conversation_state) is left completely untouched, still answerable. */
export interface ClarificationCommitFailedOutcome {
  kind: 'clarification_commit_failed';
  reason: string;
  /** TASK-BOT-008 — see `NoTransactionDetectedOutcome`'s own doc comment. */
  detectedLanguage: DetectedLanguage;
}

export interface EditValueProcessedOutcome {
  kind: 'edit_value_processed';
  processEventOutcome: ProcessConversationEventOutcome;
}

/** TASK-BOT-004's Draft Manager/category-code-resolution gap (see TransactionCommitPort's own doc comment) — editing this specific field via free text isn't wired yet. */
export interface EditFieldNotSupportedOutcome {
  kind: 'edit_field_not_supported';
  targetField: string;
}

/**
 * Free text while AWAITING_CONFIRMATION *or* AWAITING_MULTI_ITEM_REVIEW
 * (TASK-BOT-006 reuses this same outcome — both states are button-driven,
 * per FR-BOT-002/§5.7.1, and "cancel" remains meaningful in both) has no
 * guard-table row — no event is constructed, the caller should point the
 * user at the inline keyboard.
 */
export interface AwaitingConfirmationGuidanceOutcome {
  kind: 'awaiting_confirmation_guidance';
}

/**
 * TASK-BOT-005 (§5.6/ADR-CE-006/FR-AI-041/AC-CE-004) — a message received
 * while `AWAITING_CLARIFICATION` was classified `unrelated-new-transaction`
 * by the Interruption Detector (`classifyInterruption`) and committed
 * immediately, exactly as `routeFreshMessage` would from `IDLE` — but
 * without touching `conversation_state` at all, so the original pending
 * clarification (a *different* draft) is left completely untouched. The
 * caller must append §5.6's note ("I still need details on your earlier
 * entry...") to whatever it sends for this outcome.
 */
export interface InterruptionCommittedOutcome {
  kind: 'interruption_committed';
  candidate: TransactionExtractionCandidate;
  transactionId: string;
  /** TASK-BOT-008 — see `NoTransactionDetectedOutcome`'s own doc comment. */
  detectedLanguage: DetectedLanguage;
}

/** Mirrors `ProcessConversationEventUseCase`'s `commit_failed` outcome — the guard-table-equivalent decision (interrupt-and-commit) was made, but the real `TransactionCommitPort` rejected it. The pending clarification remains untouched either way. */
export interface InterruptionCommitFailedOutcome {
  kind: 'interruption_commit_failed';
  reason: string;
  /** TASK-BOT-008 — see `NoTransactionDetectedOutcome`'s own doc comment. */
  detectedLanguage: DetectedLanguage;
}

export type RouteTextMessageOutcome =
  | TextCancelledOutcome
  | ExtractionUnknownOutcome
  | NoTransactionDetectedOutcome
  | BatchAllHighConfidenceCommittedOutcome
  | BatchReviewStartedOutcome
  | CandidateProcessedOutcome
  | ClarificationProcessedOutcome
  | ClarificationResolvedOutcome
  | ClarificationCommitFailedOutcome
  | EditValueProcessedOutcome
  | EditFieldNotSupportedOutcome
  | AwaitingConfirmationGuidanceOutcome
  | InterruptionCommittedOutcome
  | InterruptionCommitFailedOutcome;

/**
 * Fields `EditTransactionUseCase` can accept without needing the still-open
 * category-code-to-UUID resolution (see `TransactionCommitPort`'s doc
 * comment, TASK-BOT-002). Exported (not module-private) so TASK-BOT-004's
 * Confirmation Renderer (`apps/telegram-bot`) can restrict which "Edit"
 * inline-keyboard buttons it offers to this same set — "only fields already
 * supported by the current edit architecture" — without duplicating or
 * drifting from this list.
 */
export const TEXT_EDITABLE_FIELDS: readonly string[] = [
  'amount',
  'merchant',
  'description',
  'location',
];

function buildEditChanges(
  targetField: string,
  rawText: string,
): Partial<TransactionEditableFields> {
  const trimmed = rawText.trim();
  if (targetField === 'amount') {
    return { amount: trimmed.replace(/[,\s]/g, '') };
  }
  return { [targetField]: trimmed } as Partial<TransactionEditableFields>;
}

/**
 * TASK-BOT-001 (Chapter 19 §19.2.2's "Text message -> AI Processing Core
 * directly" row) — the Bot Application Layer's text-routing orchestration.
 * Reads current conversation state only to decide *which* `ConversationEvent`
 * this message becomes (never to re-implement the guard table itself —
 * `ProcessConversationEventUseCase`, TASK-BOT-002, remains the sole owner
 * of state transitions and re-reads/re-validates state on its own before
 * writing). Reuses `ExtractTransactionCandidatesUseCase` (TASK-AI-002/003)
 * for all AI understanding and `EditTransactionUseCase` (TASK-FIN-001) for
 * Chapter 8 edit-value validation — invents no new business rules.
 *
 * Cancellation phrases are checked before any state-specific branching
 * (FR-CE-047 applies from *any* pending state, and BOT-002's own guard
 * table already fails safely from IDLE).
 */
@Injectable()
export class RouteTextMessageUseCase {
  constructor(
    @Inject(CONVERSATION_STATE_REPOSITORY)
    private readonly stateRepository: ConversationStateRepository,
    @Inject(DRAFT_REPOSITORY)
    private readonly draftRepository: DraftRepository,
    @Inject(TRANSACTION_COMMIT_PORT)
    private readonly transactionCommitPort: TransactionCommitPort,
    private readonly extractTransactionCandidates: ExtractTransactionCandidatesUseCase,
    private readonly processConversationEvent: ProcessConversationEventUseCase,
    private readonly editTransaction: EditTransactionUseCase,
  ) {}

  async execute(input: RouteTextMessageInput): Promise<RouteTextMessageOutcome> {
    if (isCancellationPhrase(input.text)) {
      const outcome = await this.processConversationEvent.execute(input.userId, {
        type: 'CANCELLATION',
      });
      return { kind: 'cancelled', processEventOutcome: outcome } satisfies TextCancelledOutcome;
    }

    const record = await this.stateRepository.get(input.userId);
    const now = input.currentDateTime;
    const expired = record !== null && isConversationStateExpired(record, now);
    const effectiveState: ConversationState = record === null || expired ? 'IDLE' : record.state;
    const effectiveContextPayload = record === null || expired ? null : record.contextPayload;

    switch (effectiveState) {
      case 'AWAITING_CLARIFICATION':
        return this.routeClarificationAnswer(
          input,
          effectiveContextPayload as AwaitingClarificationContext,
        );
      case 'AWAITING_EDIT_VALUE':
        return this.routeEditValue(input, effectiveContextPayload as AwaitingEditValueContext);
      case 'AWAITING_CONFIRMATION':
      case 'AWAITING_MULTI_ITEM_REVIEW':
        return { kind: 'awaiting_confirmation_guidance' };
      case 'IDLE':
      default:
        return this.routeFreshMessage(input);
    }
  }

  private async routeFreshMessage(input: RouteTextMessageInput): Promise<RouteTextMessageOutcome> {
    const extraction = await this.extractTransactionCandidates.execute({
      currentDateTime: input.currentDateTime,
      userDefaultCurrency: input.userDefaultCurrency,
      userRecentCategories: input.userRecentCategories,
      pendingClarificationContext: null,
      inputText: input.text,
    });

    if (extraction.status !== 'valid') {
      return { kind: 'extraction_unknown', reason: extraction.reason };
    }
    if (extraction.output.transactions.length === 0) {
      return {
        kind: 'no_transaction_detected',
        detectedLanguage: extraction.output.detectedLanguage,
      };
    }
    if (extraction.output.transactions.length > 1) {
      // TASK-BOT-006 (§5.7, FR-AI-011) — a compound message. Reuses this
      // SAME extraction call's own multi-candidate output; no second
      // extraction, no new AI system.
      return this.routeBatchReview(
        input,
        extraction.output.transactions,
        extraction.candidateReports,
        extraction.output.detectedLanguage,
      );
    }

    const candidate = extraction.output.transactions[0]!;
    const report = extraction.candidateReports[0]!;
    const missingField = selectClarificationField(candidate);
    const clarificationQuestion =
      report.classification === 'draft_pending_clarification'
        ? generateClarificationQuestion({
            missingField,
            language: extraction.output.detectedLanguage,
            retryCount: 0,
          })
        : null;

    // TASK-BOT-004 (§5.5) — "persisted as a draft record ... as soon as
    // it's created — not only upon final confirmation." One id
    // (`draftId`) threads through the draft row, the Redis conversation
    // context, and (on commit) the transaction's `sourceReference` — this
    // is the SAME id `CANDIDATE_RESOLVED` already carried before this task,
    // just generated once here instead of inline at the call site so both
    // this draft-creation call and the event below use the identical value.
    const draftId = randomUUID();
    const candidateRecord = candidate as unknown as Record<string, unknown>;
    const missingFields = computeRequiredFields(candidate).filter(
      (field) => candidateRecord[field] === null || candidateRecord[field] === undefined,
    );
    await this.draftRepository.create({
      id: draftId,
      userId: input.userId,
      partialData: candidate,
      missingFields,
      originalText: input.text,
      sourceType: 'text',
    });

    const processEventOutcome = await this.processConversationEvent.execute(input.userId, {
      type: 'CANDIDATE_RESOLVED',
      classification: report.classification,
      candidate,
      missingField,
      clarificationQuestion,
      draftId,
      originalText: input.text,
      sourceType: 'text',
    });

    return {
      kind: 'candidate_processed',
      processEventOutcome,
      candidate,
      clarificationQuestion,
      detectedLanguage: extraction.output.detectedLanguage,
    };
  }

  /**
   * TASK-BOT-006 (§5.7, §5.12.1's "Batch Review Coordinator") — a compound
   * message resolved to N >= 2 candidates. Every candidate gets its own
   * draft immediately (§5.5, unchanged pattern), classified by the SAME,
   * unmodified `classifyRecordConfidence`/`CandidateGuardrailReport`
   * (TASK-AI-003) every other commit path already uses — no new confidence
   * logic. §5.7's own two-way split ("X high-confidence, Y need review")
   * has no third bucket: a `draft_pending_clarification`-band item is
   * treated the same as `flagged_review` here (both "need review") —
   * TASK-BOT-004's single-item, field-specific `AWAITING_CLARIFICATION`
   * flow is deliberately NOT reused per-item inside a batch (see this
   * task's final report).
   */
  private async routeBatchReview(
    input: RouteTextMessageInput,
    candidates: readonly TransactionExtractionCandidate[],
    reports: readonly CandidateGuardrailReport[],
    detectedLanguage: DetectedLanguage,
  ): Promise<RouteTextMessageOutcome> {
    const highConfidenceDraftIds: string[] = [];
    const lowConfidenceDraftIds: string[] = [];
    const lowConfidenceCandidates: TransactionExtractionCandidate[] = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      const draftId = randomUUID();
      const candidateRecord = candidate as unknown as Record<string, unknown>;
      const missingFields = computeRequiredFields(candidate).filter(
        (field) => candidateRecord[field] === null || candidateRecord[field] === undefined,
      );
      await this.draftRepository.create({
        id: draftId,
        userId: input.userId,
        partialData: candidate,
        missingFields,
        originalText: input.text,
        sourceType: 'text',
      });

      if (reports[index]!.classification === 'auto_commit') {
        highConfidenceDraftIds.push(draftId);
      } else {
        lowConfidenceDraftIds.push(draftId);
        lowConfidenceCandidates.push(candidate);
      }
    }

    if (lowConfidenceDraftIds.length === 0) {
      // Mirrors FR-CE-040's single-item precedent applied N times — nothing
      // needs review, so AWAITING_MULTI_ITEM_REVIEW is never entered (see
      // this task's final report for why: it would otherwise be a state
      // with no low-confidence items and no natural exit transition).
      let committedCount = 0;
      const transactionIds: string[] = [];
      for (const draftId of highConfidenceDraftIds) {
        const draft = await this.draftRepository.findById(draftId);
        if (draft === null) {
          continue;
        }
        try {
          const result = await this.transactionCommitPort.commit({
            userId: input.userId,
            candidate: draft.partialData,
            draftId,
            originalText: input.text,
            sourceType: 'text',
          });
          await this.draftRepository.updateStatus(draftId, {
            status: 'completed',
            resolvedTransactionId: result.transactionId,
          });
          transactionIds.push(result.transactionId);
          committedCount += 1;
        } catch {
          // Independent, single-row commits — one failure does not block
          // the rest; the failed item's draft simply stays 'pending',
          // recoverable via /drafts, same as any other uncommitted draft.
        }
      }
      return {
        kind: 'batch_all_high_confidence_committed',
        totalItems: candidates.length,
        committedCount,
        failedCount: highConfidenceDraftIds.length - committedCount,
        transactionIds,
        detectedLanguage,
      };
    }

    const batchId = randomUUID();
    const processEventOutcome = await this.processConversationEvent.execute(input.userId, {
      type: 'BATCH_REVIEW_STARTED',
      batchId,
      totalItems: candidates.length,
      highConfidenceDraftIds,
      lowConfidenceDraftIds,
    });

    return {
      kind: 'batch_review_started',
      processEventOutcome,
      batchId,
      totalItems: candidates.length,
      highConfidenceCount: highConfidenceDraftIds.length,
      lowConfidenceCandidates,
      lowConfidenceDraftIds,
      detectedLanguage,
    };
  }

  private async routeClarificationAnswer(
    input: RouteTextMessageInput,
    context: AwaitingClarificationContext,
  ): Promise<RouteTextMessageOutcome> {
    const extraction = await this.extractTransactionCandidates.execute({
      currentDateTime: input.currentDateTime,
      userDefaultCurrency: input.userDefaultCurrency,
      userRecentCategories: input.userRecentCategories,
      pendingClarificationContext: context.lastQuestionAsked
        ? { question: context.lastQuestionAsked }
        : null,
      inputText: input.text,
    });

    // TASK-BOT-008 — moved up from its original position (just before the
    // final `clarification_processed` return) so it is available to EVERY
    // branch below that can now return before reaching that point
    // (`routeInterruptingTransaction`/`commitResolvedClarification`), not
    // just the fall-through case. Same computation, same fallback ('en'
    // only when extraction failed outright), unchanged.
    const language: DetectedLanguage =
      extraction.status === 'valid' ? extraction.output.detectedLanguage : 'en';

    // TASK-BOT-005 (§5.6/§5.12.1 Interruption Detector, ADR-CE-006, BR-CE-011)
    // — classify this message BEFORE treating it as an answer. Reuses the
    // SAME extraction call above (no second LLM system) plus the pending
    // draft's already-known intent (TASK-BOT-004's `DraftRepository`) as
    // the baseline "what is this clarification about" comparison.
    const pendingDraft = await this.draftRepository.findById(context.draftId);
    const reinterpreted =
      extraction.status === 'valid' ? (extraction.output.transactions[0] ?? null) : null;
    const reinterpretedReport =
      extraction.status === 'valid' ? (extraction.candidateReports[0] ?? null) : null;
    const interruption = classifyInterruption({
      text: input.text,
      pendingIntent: pendingDraft?.partialData.intent ?? null,
      reinterpretedIntent: reinterpreted?.intent ?? null,
      reinterpretedClassification: reinterpretedReport?.classification ?? null,
    });

    if (interruption === 'unrelated-new-transaction') {
      // ADR-CE-006 — the new transaction takes priority. The pending
      // clarification's `conversation_state` is deliberately never read or
      // written by `routeInterruptingTransaction` below, preserving it per
      // §5.6/FR-AI-041's "re-surface ... only if the user doesn't provide a
      // new answer" — never silently discarded.
      return this.routeInterruptingTransaction(input, reinterpreted!, language);
    }

    // interruption === 'continuation' (or the defensively-unreachable
    // 'cancellation' branch — `RouteTextMessageUseCase.execute` already
    // checks `isCancellationPhrase` unconditionally before this method is
    // ever invoked, per FR-CE-047 "any pending state"; `classifyInterruption`
    // still declares that branch for its own contract completeness, per
    // §5.12.3's Interruption Classification carrying all three categories).
    const fieldResolved = this.resolveClarificationField(extraction, context.missingField);

    // TASK-BOT-002-FIX (§5.2.3's state diagram: "AWAITING_CLARIFICATION ->
    // IDLE: user answers, record resolved AND COMMITTED" — FR-CE-043's
    // guard-table row was previously implemented without the commit half).
    // `pendingDraft`/`reinterpreted` were already computed above for the
    // Interruption Detector; reused here, not re-fetched/re-extracted. The
    // `pendingDraft`/`reinterpreted` null-guards below are defensive only
    // (should not happen in production — `routeFreshMessage` always creates
    // the draft before entering AWAITING_CLARIFICATION) — if hit, this
    // falls through to the pre-existing (pre-fix) FR-CE-042/FR-CE-043
    // behavior below rather than crashing or silently mis-reporting
    // `fieldResolved`.
    if (fieldResolved && pendingDraft !== null && reinterpreted !== null) {
      return this.commitResolvedClarification(
        input,
        context,
        pendingDraft.partialData,
        reinterpreted,
        language,
      );
    }

    const nextQuestion = fieldResolved
      ? null
      : generateClarificationQuestion({
          missingField: context.missingField,
          language,
          retryCount: context.retryCount + 1,
        });
    const processEventOutcome = await this.processConversationEvent.execute(input.userId, {
      type: 'CLARIFICATION_ANSWER',
      fieldResolved,
      nextQuestion,
    });

    return { kind: 'clarification_processed', processEventOutcome, nextQuestion, language };
  }

  /**
   * TASK-BOT-002-FIX — the field the pending clarification was asking
   * about resolved (`fieldResolved`); §5.2.3's state diagram is explicit
   * that this transition commits, unlike a plain FR-CE-042 retry. Merges
   * the newly-resolved value into the ORIGINAL draft's already-known data
   * (`pendingDraft.partialData`) rather than trusting the freshly
   * re-extracted candidate wholesale — that extraction call only sees
   * *this turn's* short reply plus the pending question text
   * (`pendingClarificationContext`), not the earlier turns' amount/category/
   * etc., so it alone cannot represent the full, now-complete record.
   *
   * Commits directly via the SAME `TransactionCommitPort`/`DraftRepository`
   * `routeFreshMessage`'s `auto_commit` path and TASK-BOT-005's
   * `routeInterruptingTransaction` already use — outside
   * `ProcessConversationEventUseCase`'s guard table for the commit itself
   * (FR-CE-043's row is not redesigned: it still only ever transitions
   * AWAITING_CLARIFICATION -> IDLE, exactly as before), then calls that
   * SAME, unchanged `CLARIFICATION_ANSWER`/`fieldResolved: true` path purely
   * for the state write. `draftId` is the pending draft's own, existing id
   * (never a fresh one) — `TransactionCommitPort`'s per-draftId idempotency
   * lock (TASK-FIN-REAL-001, unchanged) is therefore exactly as effective
   * here as it already is for `CANDIDATE_RESOLVED`, satisfying "duplicate
   * clarification events must never create duplicate transactions" without
   * a second idempotency mechanism.
   */
  private async commitResolvedClarification(
    input: RouteTextMessageInput,
    context: AwaitingClarificationContext,
    originalCandidate: TransactionExtractionCandidate,
    reinterpreted: TransactionExtractionCandidate,
    detectedLanguage: DetectedLanguage,
  ): Promise<RouteTextMessageOutcome> {
    const reinterpretedRecord = reinterpreted as unknown as Record<string, unknown>;
    const mergedCandidate: TransactionExtractionCandidate =
      context.missingField !== null
        ? {
            ...originalCandidate,
            [context.missingField]: reinterpretedRecord[context.missingField],
          }
        : { ...originalCandidate, intent: reinterpreted.intent };

    let transactionId: string;
    try {
      const result = await this.transactionCommitPort.commit({
        userId: input.userId,
        candidate: mergedCandidate,
        draftId: context.draftId,
        originalText: input.text,
        sourceType: 'text',
      });
      transactionId = result.transactionId;
    } catch (error) {
      // Mirrors ProcessConversationEventUseCase's existing `commit_failed`
      // handling: no draft-status write, no conversation_state write — the
      // pending clarification remains fully intact and recoverable (never
      // bounced to IDLE on a failed commit, so the user's answer is not
      // silently lost even in this failure path).
      return {
        kind: 'clarification_commit_failed',
        reason: error instanceof Error ? error.message : 'Unknown commit failure',
        detectedLanguage,
      };
    }

    await this.draftRepository.updateStatus(context.draftId, {
      status: 'completed',
      resolvedTransactionId: transactionId,
    });

    const processEventOutcome = await this.processConversationEvent.execute(input.userId, {
      type: 'CLARIFICATION_ANSWER',
      fieldResolved: true,
      nextQuestion: null,
    });

    return {
      kind: 'clarification_resolved',
      processEventOutcome,
      candidate: mergedCandidate,
      transactionId,
      detectedLanguage,
    };
  }

  /**
   * TASK-BOT-005 — commits an interrupting `unrelated-new-transaction`
   * directly, mirroring `routeFreshMessage`'s `auto_commit` path (draft
   * created, then `TransactionCommitPort.commit`, then draft marked
   * completed) but WITHOUT going through `ProcessConversationEventUseCase`:
   * `evaluateConversationTransition`'s `CANDIDATE_RESOLVED` guard requires
   * `currentState === 'IDLE'` (§5.13.2) — correct, and must not be
   * redesigned to also accept `AWAITING_CLARIFICATION` (this task's own
   * instructions forbid any guard-table change). Reusing that guard table
   * for this candidate is therefore structurally impossible; this method
   * reuses the SAME `TransactionCommitPort`/`DraftRepository` the guard
   * table's own commit side effect already uses elsewhere — not a second
   * conversation state machine, just a caller that never reads or writes
   * `conversation_state` for this specific commit, by design (the pending
   * clarification's state must survive untouched).
   */
  private async routeInterruptingTransaction(
    input: RouteTextMessageInput,
    candidate: TransactionExtractionCandidate,
    detectedLanguage: DetectedLanguage,
  ): Promise<RouteTextMessageOutcome> {
    const draftId = randomUUID();
    const candidateRecord = candidate as unknown as Record<string, unknown>;
    const missingFields = computeRequiredFields(candidate).filter(
      (field) => candidateRecord[field] === null || candidateRecord[field] === undefined,
    );
    await this.draftRepository.create({
      id: draftId,
      userId: input.userId,
      partialData: candidate,
      missingFields,
      originalText: input.text,
      sourceType: 'text',
    });

    let transactionId: string;
    try {
      const result = await this.transactionCommitPort.commit({
        userId: input.userId,
        candidate,
        draftId,
        originalText: input.text,
        sourceType: 'text',
      });
      transactionId = result.transactionId;
    } catch (error) {
      return {
        kind: 'interruption_commit_failed',
        reason: error instanceof Error ? error.message : 'Unknown commit failure',
        detectedLanguage,
      };
    }

    await this.draftRepository.updateStatus(draftId, {
      status: 'completed',
      resolvedTransactionId: transactionId,
    });

    return { kind: 'interruption_committed', candidate, transactionId, detectedLanguage };
  }

  private resolveClarificationField(
    extraction: Awaited<ReturnType<ExtractTransactionCandidatesUseCase['execute']>>,
    missingField: string | null,
  ): boolean {
    if (extraction.status !== 'valid' || extraction.output.transactions.length === 0) {
      return false;
    }
    const candidate = extraction.output.transactions[0]!;
    if (missingField === null) {
      return candidate.intent !== 'UNKNOWN';
    }
    const value = (candidate as unknown as Record<string, unknown>)[missingField];
    return value !== null && value !== undefined;
  }

  private async routeEditValue(
    input: RouteTextMessageInput,
    context: AwaitingEditValueContext,
  ): Promise<RouteTextMessageOutcome> {
    if (!TEXT_EDITABLE_FIELDS.includes(context.targetField)) {
      return { kind: 'edit_field_not_supported', targetField: context.targetField };
    }

    let valid = true;
    try {
      await this.editTransaction.execute({
        transactionId: context.targetId,
        userId: input.userId,
        changes: buildEditChanges(context.targetField, input.text),
      });
    } catch (error) {
      if (error instanceof InvalidTransactionError || error instanceof ApplicationError) {
        valid = false;
      } else {
        throw error;
      }
    }

    const processEventOutcome = await this.processConversationEvent.execute(input.userId, {
      type: 'EDIT_VALUE_PROVIDED',
      valid,
    });

    return { kind: 'edit_value_processed', processEventOutcome };
  }
}
