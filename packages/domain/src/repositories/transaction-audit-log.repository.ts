/**
 * DI token for @afa/infrastructure's implementation (a later part), same
 * Symbol-token pattern as USER_REPOSITORY.
 */
export const TRANSACTION_AUDIT_LOG_REPOSITORY = Symbol('TRANSACTION_AUDIT_LOG_REPOSITORY');

/** §13.4/migration.sql `transaction_audit_log.changed_by` CHECK values. */
export type TransactionAuditChangedBy = 'ai_original' | 'user_edit' | 'import' | 'api' | 'undo';

/**
 * One row of `transaction_audit_log` (§13.9) — FR-EXP-007's "what changed,
 * from what value to what value, when, and via which channel".
 */
export interface TransactionAuditLogEntry {
  transactionId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: TransactionAuditChangedBy;
  changedAt: Date;
}

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary) for the append-only audit
 * ledger (Chapter 16 §16.4.2 — no update()/delete() call may ever target
 * this table). Separate from `TransactionRepository` because it persists to
 * a different table representing a different concern (historical record of
 * field-level changes, not current transaction state).
 */
export interface TransactionAuditLogRepository {
  /** Batched per edit/delete/restore — one call, one or more entries. */
  record(entries: TransactionAuditLogEntry[]): Promise<void>;
}
