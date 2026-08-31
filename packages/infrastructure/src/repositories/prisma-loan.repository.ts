import { Inject, Injectable } from '@nestjs/common';
import type {
  Loan,
  LoanPayment,
  LoanRepository,
  LogLoanPaymentData,
  NewLoanData,
} from '@afa/domain';
import { Loan as LoanEntity, LoanOverpaymentError, NegativeAmortizationError } from '@afa/domain';
import { getCurrentUserId } from '@afa/shared';

import { toDomainLoanPayment } from './loan-payment.mapper';
import { toDomainLoan } from './loan.mapper';
import { PRISMA_BASE_CLIENT } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-004 (Stage B/F) — implements @afa/domain's `LoanRepository` port
 * against the `loans`/`loan_payments` tables (§13.20). RLS-protected
 * (`rls-protected-models.ts` already lists both `Loan` and `LoanPayment`,
 * built ahead of this task's own arrival).
 *
 * `findById`/`findOpenByUserId`/`create` use the normal RLS-extended
 * `this.prisma` (no paired second write, mirroring `PrismaDebtRepository.create()`'s
 * own reasoning). `logPayment` (Stage F) is the one method that needs
 * `PRISMA_BASE_CLIENT` + manual `set_config` — it combines TWO writes
 * (the `loans` UPDATE and the `loan_payments` INSERT) in one database
 * transaction, the same RLS-extension-vs-second-write conflict
 * `PrismaTransactionRepository.create()`/`PrismaDebtRepository.logRepayment()`
 * already solve identically.
 */
@Injectable()
export class PrismaLoanRepository implements LoanRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PRISMA_BASE_CLIENT) private readonly basePrisma: PrismaService,
  ) {}

  async findById(id: string): Promise<Loan | null> {
    const row = await this.prisma.loan.findUnique({ where: { id } });
    return row ? toDomainLoan(row) : null;
  }

  async findOpenByUserId(userId: string): Promise<Loan[]> {
    const rows = await this.prisma.loan.findMany({
      where: { userId, status: 'open', deletedAt: null },
      orderBy: { startDate: 'asc' },
    });
    return rows.map(toDomainLoan);
  }

  async create(data: NewLoanData): Promise<Loan> {
    const now = new Date();
    LoanEntity.validateNew(
      {
        userId: data.userId,
        lender: data.lender,
        principalAmount: data.principalAmount,
        currency: data.currency,
        interestRate: data.interestRate,
        installmentAmount: data.installmentAmount,
        installmentFrequency: data.installmentFrequency,
        startDate: data.startDate,
      },
      now,
    );

    const row = await this.prisma.loan.create({
      data: {
        userId: data.userId,
        lender: data.lender,
        principalAmount: data.principalAmount,
        outstandingBalance: data.principalAmount,
        currency: data.currency,
        interestRate: data.interestRate,
        installmentAmount: data.installmentAmount,
        installmentFrequency: data.installmentFrequency,
        startDate: data.startDate,
      },
    });
    return toDomainLoan(row);
  }

  /**
   * TASK-FIN-004 (Stage F, §8.14.6) — CONCURRENCY HARDENING (found via a
   * dedicated investigation after the Budget/SavingsGoal concurrency fixes
   * raised the question of whether this repository's own `WITH computed AS
   * (SELECT ...) UPDATE ... FROM computed` shape had the same defect).
   *
   * CONFIRMED, empirically, against a real Postgres connection (two
   * deterministically-sequenced BEGIN/hold/COMMIT transactions, not a bare
   * `Promise.all`): when a second `logPayment` call is forced to wait on
   * the first's row lock, Postgres's EvalPlanQual retry refreshes the bare
   * `loans.outstanding_balance` reference used in the old `SET` clause, but
   * NOT the separately-materialized `computed` CTE's own output —
   * `computed.principal_portion` AND `computed.outstanding_balance` (the
   * very value the old overpayment/negative-amortization guard compared
   * against) stayed frozen at the pre-wait snapshot. This let the guard
   * validate a payment against a STALE, larger balance while the actual
   * `SET` subtracted from the FRESH, smaller one — in one reproduction this
   * produced an attempted `outstanding_balance = -85000.00`, caught only by
   * the `loans_outstanding_balance_check` CHECK constraint (surfacing as an
   * unhandled `PrismaClientKnownRequestError`, not the intended graceful
   * `null`/`LoanOverpaymentError` rejection).
   *
   * FIX — lock BEFORE computing, exactly the pattern already proven for
   * `evaluateBudgetThresholdsOnExpenseCommit`/
   * `evaluateSavingsGoalProgressOnContributionCommit`: acquire `FOR NO KEY
   * UPDATE` on the row FIRST (a plain `SELECT id ...` — no computation
   * happens here, so there is nothing left for EvalPlanQual to leave
   * stale), then re-read the row through the normal typed client (a fresh
   * READ COMMITTED snapshot, guaranteed to see whatever the lock's
   * previous holder just committed), then recompute entirely in
   * TypeScript by handing that fresh row to `Loan.applyPayment()` — the
   * SAME domain method (and therefore the SAME `computeLoanAmortization`
   * formula, unmodified) `LogLoanPaymentUseCase`'s own pre-check already
   * uses, rather than a second, independently-maintained SQL re-encoding
   * of that formula. This also removes the very duplication that let the
   * two implementations (SQL vs. domain) diverge in the first place.
   *
   * `FOR NO KEY UPDATE`, not `FOR UPDATE` — `loan_payments.loan_id` has a
   * real FK to `loans.id` (`onDelete: Restrict`), so an FK-validating
   * INSERT against `loan_payments` takes an automatic `FOR KEY SHARE` on
   * the referenced `loans` row; `FOR NO KEY UPDATE` is compatible with
   * `FOR KEY SHARE` (this write never changes the primary key), avoiding
   * the `FOR UPDATE`-vs-`FOR KEY SHARE` deadlock class `FOR NO KEY UPDATE`
   * exists to prevent — the same reasoning already established for
   * `SavingsGoal`'s own FK-backed lock.
   *
   * Still returns `null` uniformly for "loan not found" / "not open" /
   * soft-deleted (no rows to lock) AND for a guard rejection
   * (`NegativeAmortizationError`/`LoanOverpaymentError`, now evaluated
   * against the true fresh balance) — preserving this method's existing
   * "generic backstop signal" contract; `Loan.applyPayment`'s own throw is
   * still the PRIMARY UX path via `LogLoanPaymentUseCase`'s pre-check
   * against its own (possibly stale, pre-transaction) read, this is the
   * atomic, always-correct final word. All of the above happens inside the
   * one `basePrisma.$transaction` — a thrown guard error rolls back
   * cleanly (nothing written), same as before.
   */
  async logPayment(data: LogLoanPaymentData): Promise<{ loan: Loan; payment: LoanPayment } | null> {
    const now = new Date();
    const userId = getCurrentUserId();

    return this.basePrisma.$transaction(
      async (tx) => {
        if (userId) {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        }

        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM loans
          WHERE id = ${data.loanId}::uuid AND status = 'open' AND deleted_at IS NULL
          FOR NO KEY UPDATE
        `;
        if (lockedRows.length === 0) {
          return null;
        }

        const freshRow = await tx.loan.findUniqueOrThrow({ where: { id: data.loanId } });
        const freshLoan = toDomainLoan(freshRow);

        let applied: { loan: Loan; principalPortion: string };
        try {
          applied = freshLoan.applyPayment(data.amount, now);
        } catch (error) {
          if (error instanceof NegativeAmortizationError || error instanceof LoanOverpaymentError) {
            return null;
          }
          throw error;
        }

        const updatedRow = await tx.loan.update({
          where: { id: data.loanId },
          data: {
            outstandingBalance: applied.loan.outstandingBalance,
            status: applied.loan.status,
            updatedAt: now,
          },
        });

        const paymentRow = await tx.loanPayment.create({
          data: {
            loanId: data.loanId,
            amount: data.amount,
            principalPortion: applied.principalPortion,
            paymentDate: data.paymentDate,
          },
        });

        return {
          loan: toDomainLoan(updatedRow),
          payment: toDomainLoanPayment(paymentRow),
        };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  }
}
