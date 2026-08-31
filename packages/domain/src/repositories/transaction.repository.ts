import type {
  PaymentMethod,
  Transaction,
  TransactionConfidenceScores,
  TransactionCreatedBy,
  TransactionEditableFields,
  TransactionSourceType,
  TransactionType,
} from '../entities/transaction.entity';

/**
 * DI token for @afa/infrastructure's Prisma-backed implementation (a later
 * part), same Symbol-token pattern as USER_REPOSITORY.
 */
export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY');

export interface NewTransactionData {
  userId: string;
  transactionType: TransactionType;
  amount: string;
  currency: string;
  exchangeRateToDefault?: string;
  /** FR-FIN-023 — optional; when omitted, the caller (`CreateExpenseUseCase`/`CreateIncomeUseCase`) resolves the user's implicit default account (§8.12.4) before calling `create()`. Must be omitted for `TRANSFER` (see `sourceAccountId`/`destinationAccountId` below) — see `Transaction`'s own validation for the exact per-type rules. */
  accountId?: string;
  /** TASK-FIN-004 (FR-FIN-004) — required when `transactionType === 'TRANSFER'`, must be omitted otherwise. */
  sourceAccountId?: string;
  /** TASK-FIN-004 (FR-FIN-004) — required when `transactionType === 'TRANSFER'`, must be omitted otherwise. */
  destinationAccountId?: string;
  /** TASK-FIN-004 (FR-FIN-005) — only meaningful on a cross-currency `TRANSFER`; must be omitted otherwise. */
  destinationAmount?: string;
  /** TASK-FIN-004 (FR-FIN-012) — required when `transactionType === 'GOAL_CONTRIBUTION'`, optional on `TRANSFER` (linked-transfer contribution mode), must be omitted otherwise. */
  goalId?: string;
  categoryId: string;
  subcategoryId?: string;
  merchant?: string;
  paymentMethod?: PaymentMethod;
  transactionDate: Date;
  transactionTime?: string;
  location?: string;
  tags?: string[];
  description: string;
  originalText: string;
  sourceType: TransactionSourceType;
  sourceReference?: string;
  confidenceScores?: TransactionConfidenceScores;
  isRecurringDetected?: boolean;
  linkedTransactionId?: string;
  createdBy: TransactionCreatedBy;
}

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary) — implemented by
 * packages/infrastructure (a later part), consumed by @afa/application's
 * expense/income use cases via TRANSACTION_REPOSITORY.
 *
 * Deliberately excludes any transaction_audit_log-writing method — that's a
 * distinct concern (a different table, an append-only historical ledger, not
 * this aggregate's own current-state persistence) served instead by the
 * separate `TransactionAuditLogRepository` port (TASK-FIN-001 Part 2),
 * consumed directly by use cases alongside this repository.
 */
export interface TransactionRepository {
  findById(id: string): Promise<Transaction | null>;
  findByUserId(userId: string, options?: { includeDeleted?: boolean }): Promise<Transaction[]>;
  create(data: NewTransactionData): Promise<Transaction>;
  update(id: string, changes: Partial<TransactionEditableFields>): Promise<Transaction>;
  /**
   * FR-EXP-006 — soft delete only, recoverable. Implementations MUST perform
   * the write as a single atomic conditional operation (only transitioning a
   * row that is not already deleted), returning `null` when no row was
   * actually transitioned by THIS call — either because it did not exist, or
   * because it was already deleted (by an earlier call, or by a genuinely
   * concurrent one). This is the port's own concurrency guarantee: the
   * caller must never infer "already deleted" from a separate, earlier read
   * (TOCTOU-unsafe under real concurrency, TASK-BOT-007-FIX) — only from this
   * method's own return value.
   */
  softDelete(id: string): Promise<Transaction | null>;
  /**
   * AC-EXP-003 — `/undo` recovery. Same atomic-conditional-write contract as
   * `softDelete` above (TASK-FIN-013 concurrency fix — the original
   * signature returned a bare `Transaction`, relying only on
   * `RestoreTransactionUseCase`'s own read-then-write pre-check, which is
   * TOCTOU-unsafe under real concurrency the exact same way `softDelete`'s
   * own doc comment already describes for delete): implementations MUST
   * perform the write as a single atomic conditional operation (only
   * transitioning a row that IS currently deleted), returning `null` when no
   * row was actually transitioned by THIS call.
   */
  restore(id: string): Promise<Transaction | null>;
  /**
   * TASK-FIN-013 (FR-UND-001) — the per-user "last action" pointer: the
   * single most recently touched transaction (by `updatedAt`, INCLUDING
   * soft-deleted rows — a delete is itself the action `/undo` may need to
   * reverse), scoped to transactions only (budgets/debts/loans/savings
   * goals restore is not built — FR-UND-008's fuller scope is a disclosed
   * gap, see this task's final report). Deliberately NOT `findByUserId`,
   * which orders by `transactionDate` (the transaction's own date), not
   * `updatedAt` (when it was last acted on) — the two are unrelated for
   * this purpose.
   */
  findMostRecentByUserId(userId: string): Promise<Transaction | null>;

  /**
   * TASK-FIN-006 (§7.4.7/§11.7.6's "migration preview" mirrored for
   * self-service custom-category deletion) — the count of non-deleted
   * transactions currently referencing `categoryId` (as either their
   * category or subcategory), scoped to `userId`. Read-only, used to show
   * the user exactly how many transactions will be re-tagged BEFORE the
   * deletion is finalized (never a blind migration) — never mutates
   * anything itself.
   */
  countActiveByCategoryId(userId: string, categoryId: string): Promise<number>;
}
