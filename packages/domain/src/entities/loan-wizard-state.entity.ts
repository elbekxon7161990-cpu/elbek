/**
 * TASK-FIN-004 (Stage I) — ephemeral, Redis-only Telegram dialog state for
 * the multi-step `/loans create` and `/loans pay` flows. Deliberately a
 * SEPARATE, minimal mechanism from `ConversationStateRepository`
 * (TASK-BOT-002's `AWAITING_CLARIFICATION`/`AWAITING_CONFIRMATION`/etc.
 * state machine) — that machine is scoped to the AI-extraction/Transaction-
 * draft domain (FR-CE-* rules) and is not a generic multi-step-wizard
 * primitive; bolting Loan-specific steps onto it would conflate two
 * unrelated state machines. This one is never persisted to Postgres — no
 * migration, no `LoanWizardState` table — matching the explicit "no new DB
 * column" instruction for this stage.
 */
export type LoanWizardStep =
  | 'AWAITING_LENDER'
  | 'AWAITING_PRINCIPAL'
  | 'AWAITING_CURRENCY'
  | 'AWAITING_INTEREST_RATE'
  | 'AWAITING_INSTALLMENT_AMOUNT'
  | 'AWAITING_INSTALLMENT_FREQUENCY'
  | 'AWAITING_START_DATE'
  | 'AWAITING_CREATE_CONFIRMATION'
  | 'AWAITING_PAYMENT_LOAN_SELECTION'
  | 'AWAITING_PAYMENT_AMOUNT'
  | 'AWAITING_PAYMENT_CONFIRMATION';

/** Partial, in-progress `/loans create` answers — every field optional since it fills in one step at a time. Stored as plain decimal/ISO strings (never a native `number`/`Date`), the same DB-P3/FR-DB-027 discipline every other layer of this codebase already follows, even though this record itself never reaches Postgres. */
export interface LoanCreateDraft {
  lender?: string;
  principalAmount?: string;
  currency?: string;
  /** `null` once the user explicitly opts out of interest ("interest-free"); a decimal-fraction string (e.g. "0.1200") once a rate is supplied; absent while still awaiting an answer. */
  interestRate?: string | null;
  installmentAmount?: string;
  installmentFrequency?: string;
  /** ISO `YYYY-MM-DD` — parsed to a `Date` only at the point `CreateLoanUseCase` is actually called. */
  startDate?: string;
}

/** Partial, in-progress `/loans pay` answers. `candidateLoanIds` is the ordered list of open loan ids presented at the selection step, so a user's numeric reply ("2") can be resolved back to a real loan id without a second database round trip. */
export interface LoanPaymentDraft {
  candidateLoanIds?: string[];
  loanId?: string;
  amount?: string;
}

/**
 * The full record stored under one Redis key per user. `version` +
 * `expiresAt` mirror `ConversationStateRecord`'s own optimistic-concurrency/
 * TTL shape exactly (same CAS discipline, BR-CE-006's own reasoning
 * generalized here) — see `LoanWizardStateRepository`'s own doc comment.
 */
export interface LoanWizardStateRecord {
  version: number;
  step: LoanWizardStep;
  createDraft: LoanCreateDraft | null;
  paymentDraft: LoanPaymentDraft | null;
  /** ISO timestamp; the record is treated as gone once this has passed, same read-time-check discipline `isConversationStateExpired` established (storage-layer Redis TTL is hygiene only, never the source of truth). */
  expiresAt: string;
}
