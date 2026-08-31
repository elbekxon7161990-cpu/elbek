/**
 * TASK-FIN-006 — ephemeral, Redis-only Telegram dialog state for the
 * `/settings → Custom categories → Add new` multi-step flow (§7.9.6's worked
 * example: name first, then parent selection). Deliberately a SEPARATE,
 * minimal mechanism from `ConversationStateRepository` and
 * `LoanWizardStateRepository` — same reasoning as the Loan Wizard's own doc
 * comment: this is Settings-menu dialog state, not the AI-extraction/
 * Transaction-draft domain, and bolting it onto either existing machine
 * would conflate unrelated concerns. Never persisted to Postgres.
 */
export type CustomCategoryWizardStep = 'AWAITING_NAME' | 'AWAITING_PARENT_SELECTION';

/**
 * The full record stored under one Redis key per user. `version` +
 * `expiresAt` mirror `LoanWizardStateRecord`'s own optimistic-concurrency/
 * TTL shape exactly.
 */
export interface CustomCategoryWizardStateRecord {
  version: number;
  step: CustomCategoryWizardStep;
  /** Set once the name step is answered (validated + duplicate-checked) — carried forward so the parent-selection step doesn't need the user to retype it. */
  name: string | null;
  /** ISO timestamp; the record is treated as gone once this has passed (read-time check, matching `isLoanWizardStateExpired`'s own established discipline). */
  expiresAt: string;
}
