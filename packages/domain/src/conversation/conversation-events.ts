import type { RecordConfidenceClassification } from '../ai-extraction/compute-record-confidence';
import type { TransactionExtractionCandidate } from '../ai-extraction/transaction-extraction-schema';
import type { TransactionSourceType } from '../entities/transaction.entity';

/**
 * TASK-BOT-002's input to the Transition Evaluator (§5.13). Every event
 * carries exactly what the guard table (§5.13.2) needs to decide the next
 * state — nothing more. `classification` reuses TASK-AI-003's
 * `RecordConfidenceClassification` (`auto_commit`/`flagged_review`/
 * `draft_pending_clarification`) directly — this task does not recompute
 * or reinterpret confidence bands (per FR-CE-040/041/044's guard
 * conditions, which are *literally* §4.6.2's bands by another name).
 */

/** IDLE + a resolved AI candidate — FR-CE-040/041/044's shared entry point (the classification alone determines which of the three fires). */
export interface CandidateResolvedEvent {
  type: 'CANDIDATE_RESOLVED';
  classification: RecordConfidenceClassification;
  candidate: TransactionExtractionCandidate;
  /**
   * Only meaningful when `classification` is `'draft_pending_clarification'`
   * (FR-CE-041). Selecting *which* field to ask about is §5.14's
   * prioritization algorithm (TASK-BOT-003 — `selectClarificationField`);
   * the caller must supply it. `null` is accepted (e.g. intent itself is
   * ambiguous rather than a specific field) and is carried through as-is.
   */
  missingField: string | null;
  /**
   * TASK-BOT-003 — the actual question text for `missingField` (Chapter 5
   * §5.3.2's Clarification Question Generator, `generateClarificationQuestion`),
   * only meaningful alongside `missingField` when `classification` is
   * `'draft_pending_clarification'`. Generating question *wording* is not
   * this evaluator's job (it stays pure/deterministic and side-effect-free
   * per this file's own doc comment) — the caller computes it and this
   * event just carries it through to `AwaitingClarificationContext.lastQuestionAsked`,
   * the same "caller supplies, evaluator stores" pattern already
   * established for `missingField` itself.
   */
  clarificationQuestion: string | null;
  draftId: string;
  /**
   * TASK-FIN-REAL-001 — `TransactionCommitPort`'s real adapter needs these
   * two for `NewTransactionData.originalText`/`sourceType` (Chapter 4 §4.8's
   * traceability requirement); a resolved candidate alone never carried
   * either. The caller (e.g. `RouteTextMessageUseCase`) is the only place
   * that actually knows the raw input and which modality produced it.
   */
  originalText: string;
  sourceType: TransactionSourceType;
}

/** AWAITING_CLARIFICATION + the user's reply — FR-CE-042/043. */
export interface ClarificationAnswerEvent {
  type: 'CLARIFICATION_ANSWER';
  /** Whether this specific answer resolved `missingField` — determined upstream by re-running extraction on the answer, out of this task's scope (Chapter 4). */
  fieldResolved: boolean;
  /**
   * TASK-BOT-003 — only meaningful when `fieldResolved` is `false` and the
   * FR-CE-042 retry branch fires (still within NFR-CE-003's budget): the
   * re-ask's question text (BR-CE-003's "re-asks once with a more specific
   * prompt"), computed by the caller via `generateClarificationQuestion`
   * against the incremented retry count. Replaces
   * `AwaitingClarificationContext.lastQuestionAsked` rather than the old
   * behavior of silently carrying the *original* (now-stale) question
   * forward unchanged.
   */
  nextQuestion: string | null;
}

/** AWAITING_CONFIRMATION + user taps "Edit" — FR-CE-045. */
export interface EditRequestedEvent {
  type: 'EDIT_REQUESTED';
  targetField: string;
}

/** AWAITING_EDIT_VALUE + user supplies a replacement — FR-CE-046. */
export interface EditValueProvidedEvent {
  type: 'EDIT_VALUE_PROVIDED';
  /** Whether the replacement value itself passed Chapter 8 domain validation — determined upstream, out of this task's scope. */
  valid: boolean;
}

/**
 * Any pending state + a cancellation phrase — FR-CE-047 for
 * `AWAITING_CLARIFICATION`/`AWAITING_CONFIRMATION`/`AWAITING_EDIT_VALUE`;
 * FR-CE-052 for `AWAITING_MULTI_ITEM_REVIEW` specifically (TASK-BOT-006 —
 * that state alone requires an explicit confirmation before discarding,
 * per §5.20.3; the evaluator itself decides which rule applies from
 * `currentState`, this event carries nothing extra).
 */
export interface CancellationEvent {
  type: 'CANCELLATION';
}

/**
 * TASK-BOT-006 (§5.7, §5.12.1's "Batch Review Coordinator") — IDLE + a
 * resolved batch of N >= 2 candidates from a single compound message
 * (FR-AI-011). Every candidate already has its own `transaction_drafts`
 * row (§5.5, unchanged) by the time this event is constructed — the
 * caller (`RouteTextMessageUseCase`) creates them and classifies each by
 * the existing, unmodified `classifyRecordConfidence` (TASK-AI-003) before
 * building this event, the same "caller supplies, evaluator stores"
 * pattern `CandidateResolvedEvent.missingField` already established.
 */
export interface BatchReviewStartedEvent {
  type: 'BATCH_REVIEW_STARTED';
  batchId: string;
  totalItems: number;
  /** "Already-committable" (§5.13.4) — offered as an optional single-tap batch commit (FR-CE-031), never auto-committed by this event alone. */
  highConfidenceDraftIds: readonly string[];
  /** Reviewed one at a time (FR-CE-032). */
  lowConfidenceDraftIds: readonly string[];
}

/**
 * AWAITING_MULTI_ITEM_REVIEW + user Confirms or Skips the item currently
 * at `AwaitingMultiItemReviewContext.currentIndex` (FR-CE-032). Any real
 * commit this represents (a Confirm) has already happened by the time this
 * event is constructed, via the same direct `TransactionCommitPort` call
 * TASK-BOT-005/TASK-BOT-002-FIX already use for a commit outside this
 * evaluator's own guard-requested path — this event only ever advances the
 * review position, it never itself requests a commit.
 */
export interface BatchItemReviewedEvent {
  type: 'BATCH_ITEM_REVIEWED';
}

export type ConversationEvent =
  | CandidateResolvedEvent
  | ClarificationAnswerEvent
  | EditRequestedEvent
  | EditValueProvidedEvent
  | CancellationEvent
  | BatchReviewStartedEvent
  | BatchItemReviewedEvent;
