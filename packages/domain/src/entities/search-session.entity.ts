/**
 * TASK-FIN-012 (Chapter 10 §10.3, FR-SCH-001 — "structured filter input ...
 * via a guided inline-keyboard flow") — ephemeral, Redis-only Telegram
 * dialog state for the multi-step `/search` filter-building flow. Mirrors
 * `LoanWizardStateRecord`'s own precedent exactly: deliberately a SEPARATE,
 * minimal mechanism from `ConversationStateRepository` (TASK-BOT-002's
 * closed `AWAITING_CLARIFICATION`/`AWAITING_CONFIRMATION`/etc. state
 * machine, scoped to the AI-extraction/Transaction-draft domain, not a
 * generic multi-step-wizard primitive) — the exact same reasoning
 * `loan-wizard-state.entity.ts`'s own doc comment already gives for why the
 * Loan Wizard needed its own state instead of extending that machine.
 * Never persisted to Postgres — no migration, no new table.
 */
export type SearchFilterField =
  | 'category'
  | 'merchant'
  | 'transactionType'
  | 'dateFrom'
  | 'dateTo'
  | 'minAmount'
  | 'maxAmount'
  | 'tags';

/**
 * Partial, in-progress `/search` filter selections — every field optional
 * since the guided flow fills them in one at a time. `category` holds the
 * user-typed category CODE (validated at input time via
 * `CategoryRepository.findByCode`, but kept as the human-readable code, not
 * the resolved UUID, so it can be redisplayed in the filter-menu summary
 * without a second lookup) — resolved to `ReportQueryFilters.categoryId`
 * only once, immediately before the search itself runs. `transactionType`
 * and the rest are stored already validated; canonical decimal/ISO strings,
 * the same DB-P3/FR-DB-027 discipline every other layer of this codebase
 * follows even though this record itself never reaches Postgres.
 */
export interface SearchFilters {
  category?: string;
  merchant?: string;
  transactionType?: string;
  /** ISO `YYYY-MM-DD`, inclusive lower bound. */
  dateFrom?: string;
  /** ISO `YYYY-MM-DD`, inclusive upper bound. */
  dateTo?: string;
  minAmount?: string;
  maxAmount?: string;
  tags?: readonly string[];
}

/**
 * The full record stored under one Redis key per user. `version` +
 * `expiresAt` mirror `LoanWizardStateRecord`'s own optimistic-concurrency/TTL
 * shape exactly (BR-CE-006's reasoning generalized here) — see
 * `SearchSessionRepository`'s own doc comment.
 */
export interface SearchSessionRecord {
  version: number;
  filters: SearchFilters;
  /** Which single field the next plain-text message will answer; `null` when the filter menu itself is showing (no pending question). */
  awaitingField: SearchFilterField | null;
  /** Zero-based page index of the last-shown (or about-to-be-shown) result set. */
  page: number;
  /** ISO timestamp; the record is treated as gone once this has passed — same read-time-check discipline `isConversationStateExpired`/`isLoanWizardStateExpired` already establish. */
  expiresAt: string;
}
