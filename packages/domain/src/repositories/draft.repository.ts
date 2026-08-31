import type { TransactionExtractionCandidate } from '../ai-extraction/transaction-extraction-schema';
import type { TransactionSourceType } from '../entities/transaction.entity';

/**
 * DI token for @afa/infrastructure's implementation, same Symbol-token
 * pattern as CONVERSATION_STATE_REPOSITORY/TRANSACTION_AUDIT_LOG_REPOSITORY.
 */
export const DRAFT_REPOSITORY = Symbol('DRAFT_REPOSITORY');

/** §13.5 migration.sql `transaction_drafts.status` CHECK values. */
export type DraftStatus = 'pending' | 'completed' | 'abandoned' | 'expired';

/**
 * TASK-BOT-004 (Chapter 5 §5.5 "Draft Persistence", §13.5) — one row of
 * `transaction_drafts`. `partialData` is the candidate exactly as extracted
 * (whatever fields are known so far, including nulls for the rest) — this
 * is deliberately the *same* `TransactionExtractionCandidate` shape the
 * Conversation Engine already carries end-to-end, not a separate/duplicated
 * transaction model (§5.5's own header: "any transaction candidate ... is
 * persisted as a draft record ... as soon as it's created").
 */
export interface TransactionDraftRecord {
  id: string;
  userId: string;
  partialData: TransactionExtractionCandidate;
  /** Snapshot, at creation time, of every required field still `null` (TASK-AI-003's `computeRequiredFields`) — distinct from the Redis conversation state's single `missingField` (§5.14's one-at-a-time UX selection); this is the full set, for `/drafts`' summary. */
  missingFields: readonly string[];
  status: DraftStatus;
  originalText: string;
  sourceType: TransactionSourceType;
  resolvedTransactionId: string | null;
  createdAt: Date;
  lastInteractionAt: Date;
  deletedAt: Date | null;
}

export interface NewTransactionDraftData {
  /** Caller-supplied (the same id already threaded through `CandidateResolvedEvent.draftId`/`TransactionCommitRequest.draftId`) — this port never generates its own id, so one candidate has exactly one id across Redis conversation context, the committed transaction's `source_reference`, and this draft row. */
  id: string;
  userId: string;
  partialData: TransactionExtractionCandidate;
  missingFields: readonly string[];
  originalText: string;
  sourceType: TransactionSourceType;
}

/** Patch applied by `updateStatus` — a single lifecycle-update method rather than one method per status, since every status transition this task needs (`completed`, `abandoned`) is "set status (+ optionally resolvedTransactionId) and bump lastInteractionAt." */
export interface DraftStatusPatch {
  status: DraftStatus;
  resolvedTransactionId?: string;
}

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary) for `transaction_drafts`
 * (§13.5). Deliberately minimal: no `update(partialData)` /
 * `delete()` / `restore()` — this task's scope is create-once,
 * status-lifecycle-update, and read; nothing edits a draft's `partialData`
 * after creation (an in-flight clarification answer produces a *new*
 * candidate that flows through the same conversation-state mechanism
 * TASK-BOT-002 already owns, not a draft mutation).
 */
export interface DraftRepository {
  create(data: NewTransactionDraftData): Promise<TransactionDraftRecord>;
  findById(id: string): Promise<TransactionDraftRecord | null>;
  /** FR-CE-020 — a user's own non-terminal (`pending`), non-deleted drafts, most-recent-first. Lazy 30-day expiry (`isDraftExpired`) is applied by the caller, not this method — see that function's own doc comment. */
  findActiveByUserId(userId: string): Promise<TransactionDraftRecord[]>;
  updateStatus(id: string, patch: DraftStatusPatch): Promise<TransactionDraftRecord>;
}
