export const ACCOUNT_PURGE_REPOSITORY = Symbol('ACCOUNT_PURGE_REPOSITORY');

/** Minimal per-user data this port needs — deliberately not the full `User` entity, since by the time `purgeUser` returns, the `users` row it came from no longer exists. */
export interface AccountPurgeCandidate {
  id: string;
  telegramUserId: bigint;
  preferredLanguage: string;
}

/** Row counts actually deleted, one field per table in the FK-safe purge order — carried in the final `audit_log` entry's `metadata`, not asserted anywhere else. */
export interface AccountPurgeCounts {
  debtRepayments: number;
  budgetNotificationLog: number;
  loanPayments: number;
  transactionAuditLog: number;
  transactionDrafts: number;
  scheduledTransactions: number;
  transactions: number;
  debts: number;
  budgets: number;
  loans: number;
  accounts: number;
  savingsGoals: number;
  counterparties: number;
  recurringTemplates: number;
  notifications: number;
  userSettings: number;
  userFinancialSummary: number;
  customCategories: number;
}

export type AccountPurgeOutcome =
  | { kind: 'purged'; candidate: AccountPurgeCandidate; counts: AccountPurgeCounts }
  /**
   * Object Storage cleanup did not complete successfully — per FR-RET-002,
   * this must never be silently treated as success. The `users` row and
   * every already-processed Postgres table are left exactly as they are
   * (each delete this task performs is idempotent per-table, so a retried
   * `purgeUser` call simply re-sweeps already-empty tables and tries
   * storage again) — nothing here is rolled back, and nothing here is
   * unsafe to redo.
   */
  | { kind: 'storage_failure'; candidate: AccountPurgeCandidate };

/**
 * TASK-AUTH-006 (FR-RET-002 — hard purge "across PostgreSQL and Object
 * Storage"). A dedicated, narrow port for the one destructive operation the
 * scheduled purge job performs — deliberately separate from
 * `UserRepository` (which owns the `users` row's own state machine, not
 * cross-table cascade orchestration), following this codebase's own
 * established precedent of one purpose-built repository per distinct
 * capability (`DebtReminderRepository`, `ExpenseHistoryRepository`).
 */
export interface AccountPurgeRepository {
  purgeUser(candidate: AccountPurgeCandidate, now: Date): Promise<AccountPurgeOutcome>;
}
