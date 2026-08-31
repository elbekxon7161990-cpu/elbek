import type { Loan, LoanInstallmentFrequency } from '../entities/loan.entity';
import type { LoanPayment } from '../entities/loan-payment.entity';

export const LOAN_REPOSITORY = Symbol('LOAN_REPOSITORY');

export interface NewLoanData {
  userId: string;
  lender: string;
  principalAmount: string;
  currency: string;
  interestRate: string | null;
  installmentAmount: string;
  installmentFrequency: LoanInstallmentFrequency;
  startDate: Date;
}

export interface LogLoanPaymentData {
  loanId: string;
  amount: string;
  paymentDate: Date;
}

/**
 * TASK-FIN-004 (Stage B, Chapter 8 §8.8) — port for the `loans` table
 * (§13.20.2), following the dedicated-repository precedent `DebtRepository`/
 * `AccountRepository` already established (a `Loan` is not a `Transaction`,
 * and — per TASK-FIN-004 Stage A's approved architecture decision — is not
 * an `Account` either; it needs its own independent read/write path).
 *
 * TASK-FIN-004 Stage F adds `logPayment` — see its own doc comment below
 * for the exact atomicity/rejection contract, now that the three product
 * decisions blocking it have been explicitly approved.
 */
export interface LoanRepository {
  /** No `userId` parameter — ownership scoping for a single-row read is the RLS policy's own job (same convention `AccountRepository.findById`/`DebtRepository.findById` already establish), enforced by the caller's `runWithUserContext` wrapping. */
  findById(id: string): Promise<Loan | null>;

  /** Scoped to one user, excludes soft-deleted rows AND `'paid_off'` loans — the `/loans` list (FR-FIN-009), mirroring `DebtRepository.findOpenByUserId`'s identical shape. A `'paid_off'` loan remains findable via `findById` alone, simply excluded from this list. */
  findOpenByUserId(userId: string): Promise<Loan[]>;

  /** Validates the not-yet-persisted loan (`Loan.validateNew`) BEFORE any database write, mirroring `DebtRepository.create()`'s own atomic-validation-first discipline. */
  create(data: NewLoanData): Promise<Loan>;

  /**
   * TASK-FIN-004 (Stage F, §8.14.6). Atomically inserts the `LoanPayment`
   * row AND updates the parent `Loan`'s `outstandingBalance`/`status` in
   * ONE database transaction — mirrors `DebtRepository.logRepayment`'s own
   * shape exactly. `principal_portion` is computed server-side, atomically,
   * against the loan's CURRENT `outstandingBalance` (never a stale
   * pre-read value a concurrent payment could have already changed).
   *
   * Returns `null` if the conditional update matched zero rows — the loan
   * was not `'open'`/did not exist, OR the computed `principal_portion`
   * would violate one of the two approved Stage F rejection rules
   * (OVERPAYMENT = REJECT, NEGATIVE AMORTIZATION = REJECT). The caller is
   * expected to have already decided (via `Loan.applyPayment`'s own
   * pre-check) that this amount is safe to apply; a `null` return here is
   * the same defense-in-depth backstop `DebtRepository.logRepayment`'s own
   * doc comment describes, not the primary rejection path.
   */
  logPayment(data: LogLoanPaymentData): Promise<{ loan: Loan; payment: LoanPayment } | null>;
}
