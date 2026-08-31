import type { DebtDirection } from '../entities/debt.entity';
import type { Debt } from '../entities/debt.entity';
import type { DebtRepayment } from '../entities/debt-repayment.entity';

export const DEBT_REPOSITORY = Symbol('DEBT_REPOSITORY');

export interface NewDebtData {
  userId: string;
  direction: DebtDirection;
  counterpartyName: string;
  counterpartyRefId: string | null;
  originalAmount: string;
  currency: string;
  transactionDate: Date;
  dueDate: Date | null;
  notes: string | null;
  originalText: string;
}

export interface LogDebtRepaymentData {
  debtId: string;
  amount: string;
  currency: string;
  repaymentDate: Date;
  originalText: string;
}

/**
 * TASK-FIN-002 (Chapter 8 §8.3) — port for the `debts`/`debt_repayments`
 * tables, following the dedicated-repository precedent (not extending
 * `TransactionRepository` — a `Debt` is not a `Transaction`, and BR-DBT-003
 * requires DEBT_* records to never contaminate normal Expense/Income
 * aggregation, so the two must stay wholly independent read/write paths).
 */
export interface DebtRepository {
  findById(id: string): Promise<Debt | null>;

  /** Scoped to one user (BR-DBT-002), excludes soft-deleted rows, excludes `'forgiven'`/`'repaid'` — for `/debts` (FR-DBT-006). */
  findOpenByUserId(userId: string): Promise<Debt[]>;

  /**
   * TASK-REP-001 (remaining scope, §9.1.4 Debt Summary Report — "historical
   * settled debts"). Scoped to one user, excludes soft-deleted rows,
   * INCLUDES both terminal statuses (`'repaid'` and `'forgiven'` — §8.3's
   * own `DebtStatus` doc comment: both are terminal, distinguished only by
   * whether the zero balance was reached via real repayments or an explicit
   * write-off) — no new status is introduced. Ordered most-recently-settled
   * first (`updatedAt desc`), the natural reading of "settled" for a report
   * (mirrors `findOpenByUserId`'s own `dueDate asc` ordering choice: most
   * relevant-to-the-view-purpose first).
   */
  findSettledByUserId(userId: string): Promise<Debt[]>;

  /**
   * Repayment-matching candidate pool (FR-DBT-003) — one user's own open
   * debts with a specific counterparty and direction. `direction` here is
   * the DEBT's own direction (not the repayment's) — e.g. a "repayment
   * received" (the user was owed money and got paid back) matches against
   * `direction: 'given'` debts.
   */
  findOpenByCounterparty(
    userId: string,
    counterpartyRefId: string,
    direction: DebtDirection,
  ): Promise<Debt[]>;

  /**
   * Validates the not-yet-persisted debt (`Debt.validateNew`) BEFORE any
   * database write (the atomic-validation lesson) — implementations must
   * never persist a row for a rejected `create()` call.
   */
  create(data: NewDebtData): Promise<Debt>;

  /**
   * Atomically inserts the `DebtRepayment` row AND updates the parent
   * `Debt`'s `outstandingBalance`/`status` in ONE database transaction
   * (mirroring `PrismaTransactionRepository.create()`'s own
   * state-change-and-event coupling, applied here to a coupled pair of
   * ordinary writes instead of a write-plus-domain-event). The balance
   * update is a single conditional SQL statement
   * (`WHERE status = 'open' AND outstanding_balance >= amount`), computed
   * DB-side — never read-then-write — so it is TOCTOU-safe under real
   * concurrency and independently re-enforces BR-DBT-001 (never negative)
   * at the database layer, exactly as TASK-BOT-007-FIX's conditional
   * `UPDATE ... WHERE deleted_at IS NULL` does for soft-delete.
   *
   * Returns `null` if the conditional update matched zero rows — the debt
   * was not `'open'`, or `amount` would overpay it. The caller is expected
   * to have already decided (via `Debt.applyRepayment`'s own pre-check)
   * that this amount is safe to apply; a `null` return here is the same
   * defense-in-depth backstop, not the primary overpayment-prevention path.
   */
  logRepayment(
    data: LogDebtRepaymentData,
  ): Promise<{ debt: Debt; repayment: DebtRepayment } | null>;

  /** FR-DBT-005 (P1) — atomic conditional transition (`WHERE status = 'open'`); returns `null` if the debt was not open (already repaid/forgiven, or does not exist). */
  forgive(debtId: string, now: Date): Promise<Debt | null>;
}
