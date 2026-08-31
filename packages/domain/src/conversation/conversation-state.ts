/**
 * TASK-BOT-002 (Chapter 5 §5.2.1) — the four states that task's own
 * Description scoped it to: "Core conversation state machine (IDLE,
 * AWAITING_CLARIFICATION, AWAITING_CONFIRMATION, AWAITING_EDIT_VALUE)".
 *
 * TASK-BOT-006 (§5.7) adds `AWAITING_MULTI_ITEM_REVIEW`, per §5.12.3's
 * "Contract evolution rule: additive changes only" — the other two states
 * §5.2.1 still defines (`IN_BUDGET_SETUP`, `IN_SETTINGS_FLOW`, owned by a
 * future Budget task and a future Settings task respectively) remain
 * deliberately excluded.
 */
export type ConversationState =
  | 'IDLE'
  | 'AWAITING_CLARIFICATION'
  | 'AWAITING_CONFIRMATION'
  | 'AWAITING_EDIT_VALUE'
  | 'AWAITING_MULTI_ITEM_REVIEW';

/** §5.13.4 — AWAITING_CLARIFICATION's context payload shape. */
export interface AwaitingClarificationContext {
  draftId: string;
  /** "the single field currently being asked about, per §5.14" — §5.14's own prioritization algorithm is TASK-BOT-003's job; this task's Transition Evaluator accepts whichever field the caller supplies, it does not select one itself. `null` means the intent itself is ambiguous rather than a specific field (§5.3.1's second trigger). */
  missingField: string | null;
  retryCount: number;
  lastQuestionAsked: string | null;
}

/** §5.13.4 — AWAITING_CONFIRMATION's context payload shape. */
export interface AwaitingConfirmationContext {
  /** Per FR-CE-012's "commit with flagged review" model — the transaction is already committed by the time this state is entered (§5.13.4's own note). */
  transactionId: string;
  /** TASK-BOT-004 (additive, §5.12.3 "contract evolution rule") — the `transaction_drafts` row this confirmation resolves, needed so an Undo (FR-CE-013) can mark that same draft `abandoned` after reversing `transactionId`'s commit, without a reverse DB lookup. */
  draftId: string;
  flaggedFields: readonly string[];
}

/** §5.13.4 — AWAITING_EDIT_VALUE's context payload shape. */
export interface AwaitingEditValueContext {
  targetId: string;
  targetField: string;
}

/**
 * TASK-BOT-006 (§5.13.4 — "batch_id, total_items, current_index,
 * high_confidence_ids (already-committable), low_confidence_ids (pending
 * individual review)") — AWAITING_MULTI_ITEM_REVIEW's context payload
 * shape. `highConfidenceDraftIds`/`lowConfidenceDraftIds` are
 * `transaction_drafts.id` values (see this task's final report, ambiguity
 * point D) — every candidate in the batch already has its own draft
 * (§5.5's "as soon as it's created" rule, unchanged), regardless of
 * confidence band; nothing here duplicates that data.
 */
export interface AwaitingMultiItemReviewContext {
  batchId: string;
  totalItems: number;
  /** "Already-committable" (§5.13.4) — offered as one optional, single-tap batch commit (FR-CE-031); never auto-committed on entry, unlike a single-candidate `auto_commit`. */
  highConfidenceDraftIds: readonly string[];
  /** Reviewed one at a time, in order, via `currentIndex` (FR-CE-032). */
  lowConfidenceDraftIds: readonly string[];
  /** Index into `lowConfidenceDraftIds` of the item currently being shown. */
  currentIndex: number;
  /** FR-CE-052 — set by a first cancellation attempt; a second one (this flag already `true`) actually discards. Reset to `false` by any ordinary review action, so the confirmation window doesn't stay open indefinitely. */
  pendingCancelConfirmation: boolean;
}

export type ConversationContextPayload =
  | AwaitingClarificationContext
  | AwaitingConfirmationContext
  | AwaitingEditValueContext
  | AwaitingMultiItemReviewContext
  | null;

/**
 * §5.2.2 — "Stored in Redis as `conversation_state:{user_id}` -> JSON blob
 * containing `state`, `context_payload`, `created_at`, `expires_at`."
 * `version` is this task's own addition (not a named PRD field) — the
 * increment counter BR-CE-006's compare-and-set operation needs to detect
 * a stale write; the Redis adapter is where this becomes a real atomic
 * primitive (see `ConversationStateRepository`'s doc comment).
 */
export interface ConversationStateRecord {
  userId: string;
  state: ConversationState;
  contextPayload: ConversationContextPayload;
  createdAt: string;
  /** `null` only for `IDLE` — §5.2.2's TTLs apply exclusively to the three pending states. */
  expiresAt: string | null;
  version: number;
}

export function createIdleState(userId: string, now: string): ConversationStateRecord {
  return {
    userId,
    state: 'IDLE',
    contextPayload: null,
    createdAt: now,
    expiresAt: null,
    version: 0,
  };
}
