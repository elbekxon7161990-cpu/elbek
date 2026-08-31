import {
  compareDecimalAmounts,
  isNonEmptyString,
  isValidCurrencyCode,
  isValidDecimalAmount,
  isValidNonNegativeDecimalAmount,
  isValidNonNegativeDecimalFraction,
  subtractDecimalAmounts,
} from './decimal-amount';
import { InvalidLoanError } from '../errors/invalid-loan.error';
import { LoanOverpaymentError } from '../errors/loan-overpayment.error';
import { NegativeAmortizationError } from '../errors/negative-amortization.error';
import {
  computeLoanAmortization,
  installmentsPerYearFor,
} from '../loans/compute-loan-amortization';

/**
 * TASK-FIN-004 (Chapter 8 §8.8 Loan Management, §13.20 `loans`).
 * ADR-FIN-002 — Loan is a sibling to Debt Management (TASK-FIN-002), never a
 * merged concept: a `Loan` is a distinct record type from
 * `DEBT_GIVEN`/`DEBT_RECEIVED`, and per TASK-FIN-004 Stage A's approved
 * architecture decision (Open Question A), `Loan`/`LoanPayment` are
 * deliberately standalone from `Account`/`Transaction` — the same standalone
 * relationship Debt already has with account balances.
 *
 * TASK-FIN-004 Stage F — `applyPayment` below implements §8.14.6's
 * amortization formula plus the three explicitly-approved product
 * decisions (OVERPAYMENT = REJECT, PARTIAL/IRREGULAR PAYMENTS = ALLOWED,
 * NEGATIVE AMORTIZATION = REJECT). No other payment semantics are invented
 * here — due-date calculation, payment editing/deletion, and cross-currency
 * payments remain out of scope (PRD-silent or schema-forced, per this
 * stage's own preflight report).
 */
export type LoanInstallmentFrequency = 'weekly' | 'monthly' | 'quarterly';

/** §13.20.2 CHECK (status IN ('open','paid_off')) — no 'forgiven'/'defaulted' state exists for Loan (unlike Debt's `DebtStatus`), confirmed absent from both the PRD and the schema; not invented here. */
export type LoanStatus = 'open' | 'paid_off';

const LOAN_INSTALLMENT_FREQUENCIES: readonly LoanInstallmentFrequency[] = [
  'weekly',
  'monthly',
  'quarterly',
];
const LOAN_STATUSES: readonly LoanStatus[] = ['open', 'paid_off'];

export interface LoanProps {
  id: string;
  userId: string;
  /** FR-FIN-007 — e.g. "Ipoteka Bank", "Uzum Nasiya"; free text, no lender registry. */
  lender: string;
  /** CHECK principal_amount > 0 (§13.20.2). Never changes after creation. */
  principalAmount: string;
  /** CHECK outstanding_balance >= 0 (§13.20.2) — decreases via `LoanPayment`s (TASK-FIN-004 Stage E), reaches 0 exactly when `status` becomes `'paid_off'`. */
  outstandingBalance: string;
  currency: string;
  /**
   * FR-FIN-007 / §13.20.3 — `NUMERIC(6,4)`, "Annual rate as a decimal
   * fraction" (e.g. `"0.1200"` for 12%, NOT `"12.00"`); `null` is valid and
   * means interest-free (many informal-formal installment plans are
   * interest-free). TASK-FIN-004 Stage F correction: an earlier
   * implementation of this field treated it as a whole-number percentage
   * requiring `/100`, contradicting §13.20.3's own explicit "decimal
   * fraction" documentation — that convention has been fully removed (see
   * `compute-loan-amortization.ts`).
   */
  interestRate: string | null;
  installmentAmount: string;
  installmentFrequency: LoanInstallmentFrequency;
  /** Calendar date only (§13.20.2 `DATE`). The PRD states no future/past sanity rule for this field (unlike Debt's `dueDate`) — not invented here. */
  startDate: Date;
  status: LoanStatus;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Shape needed to validate a not-yet-persisted loan. `outstandingBalance`/
 * `status` are excluded on purpose — a brand-new loan always starts fully
 * outstanding and `'open'` (§8.8.3), mirroring `Debt`'s own
 * `NewDebtValidationProps` precedent exactly.
 */
export type NewLoanValidationProps = Omit<
  LoanProps,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'outstandingBalance' | 'status'
>;

/**
 * §8.8's core aggregate. Enforces the same defense-in-depth relationship
 * with the `loans` table's own CHECK constraints that `Transaction`/`Debt`/
 * `Account` already establish for their own tables.
 */
export class Loan {
  readonly id: string;
  readonly userId: string;
  readonly lender: string;
  readonly principalAmount: string;
  readonly outstandingBalance: string;
  readonly currency: string;
  readonly interestRate: string | null;
  readonly installmentAmount: string;
  readonly installmentFrequency: LoanInstallmentFrequency;
  readonly startDate: Date;
  readonly status: LoanStatus;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: LoanProps) {
    Loan.validate(props);
    this.id = props.id;
    this.userId = props.userId;
    this.lender = props.lender;
    this.principalAmount = props.principalAmount;
    this.outstandingBalance = props.outstandingBalance;
    this.currency = props.currency;
    this.interestRate = props.interestRate;
    this.installmentAmount = props.installmentAmount;
    this.installmentFrequency = props.installmentFrequency;
    this.startDate = props.startDate;
    this.status = props.status;
    this.deletedAt = props.deletedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /**
   * Standing invariants only — checked on EVERY reconstruction, including
   * reading an existing loan back from the database (same category of
   * "always re-checked, not just at creation" rule `Debt.validate` already
   * follows).
   */
  private static validate(props: LoanProps): void {
    if (!isNonEmptyString(props.id)) {
      throw new InvalidLoanError('Loan id is required.');
    }
    if (!isNonEmptyString(props.userId)) {
      throw new InvalidLoanError('Loan userId is required.');
    }
    if (!isNonEmptyString(props.lender)) {
      throw new InvalidLoanError('Loan lender is required.');
    }
    if (!isValidDecimalAmount(props.principalAmount)) {
      throw new InvalidLoanError(
        `principalAmount must be a positive decimal value, got "${props.principalAmount}".`,
      );
    }
    if (!isValidNonNegativeDecimalAmount(props.outstandingBalance)) {
      throw new InvalidLoanError(
        `outstandingBalance must be a non-negative decimal value, got "${props.outstandingBalance}".`,
      );
    }
    // Mirrors Debt's own "outstanding cannot exceed original" invariant —
    // no valid sequence of creation/payments can produce this state.
    if (compareDecimalAmounts(props.outstandingBalance, props.principalAmount) === 1) {
      throw new InvalidLoanError('outstandingBalance cannot exceed principalAmount.');
    }
    if (!isValidCurrencyCode(props.currency)) {
      throw new InvalidLoanError(
        `currency must be a 3-letter ISO 4217 code, got "${props.currency}".`,
      );
    }
    // FR-FIN-007 / §13.20.3 — non-negative decimal FRACTION when provided
    // (NUMERIC(6,4) precision/scale — e.g. "0.1200" for 12%), null means
    // interest-free. Deliberately `isValidNonNegativeDecimalFraction`, not
    // the money-field `isValidNonNegativeDecimalAmount` (2-decimal ceiling)
    // — see that validator's own doc comment for why.
    if (props.interestRate !== null && !isValidNonNegativeDecimalFraction(props.interestRate)) {
      throw new InvalidLoanError(
        `interestRate, when provided, must be a non-negative decimal fraction (e.g. "0.1200" for 12%), got "${props.interestRate}".`,
      );
    }
    if (!isValidDecimalAmount(props.installmentAmount)) {
      throw new InvalidLoanError(
        `installmentAmount must be a positive decimal value, got "${props.installmentAmount}".`,
      );
    }
    if (!LOAN_INSTALLMENT_FREQUENCIES.includes(props.installmentFrequency)) {
      throw new InvalidLoanError(
        `Invalid installmentFrequency: "${String(props.installmentFrequency)}".`,
      );
    }
    if (!(props.startDate instanceof Date) || Number.isNaN(props.startDate.getTime())) {
      throw new InvalidLoanError('Loan startDate must be a valid Date.');
    }
    if (!LOAN_STATUSES.includes(props.status)) {
      throw new InvalidLoanError(`Invalid loan status: "${String(props.status)}".`);
    }
    // status<->balance consistency, mirroring Debt's identical rule. Loan's
    // schema has no 'forgiven'/'defaulted' state, so 'paid_off' can only
    // ever mean "reached zero via payments" — no other path exists.
    const isZeroBalance = compareDecimalAmounts(props.outstandingBalance, '0') === 0;
    if (props.status === 'paid_off' && !isZeroBalance) {
      throw new InvalidLoanError('A "paid_off" loan must have a zero outstandingBalance.');
    }
    if (props.status === 'open' && isZeroBalance) {
      throw new InvalidLoanError('An "open" loan cannot have a zero outstandingBalance.');
    }
  }

  /** Validates a not-yet-persisted loan (TASK-FIN-004 Stage C's Create Loan use case) without requiring persistence-assigned fields. */
  static validateNew(props: NewLoanValidationProps, now: Date = new Date()): void {
    Loan.validate({
      ...props,
      id: 'pending',
      outstandingBalance: props.principalAmount,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  /**
   * TASK-FIN-004 (Stage F, §8.14.6, AC-FIN-003). Pure arithmetic + the
   * three approved product-decision checks, mirroring
   * `Debt.applyRepayment`'s own "pre-check / UX role" — used both directly
   * by domain tests, and by the application layer as a pre-check before
   * calling `LoanRepository.logPayment`'s own atomic SQL, which
   * independently re-enforces the SAME two rejection rules at the database
   * layer (defense in depth, the same relationship `Debt.applyRepayment`
   * has with `PrismaDebtRepository.logRepayment`'s own atomic conditional
   * `UPDATE`).
   *
   * Throws `NegativeAmortizationError` when the computed `principal_portion`
   * is strictly negative (the payment doesn't cover the interest portion
   * due) — NEGATIVE AMORTIZATION = REJECT, never clamped to zero, never
   * allowed to increase `outstandingBalance`. A `principal_portion` of
   * exactly zero (an interest-only payment) is NOT rejected — only a value
   * strictly below zero is.
   *
   * Throws `LoanOverpaymentError` when `principal_portion` exceeds the
   * current `outstandingBalance` — OVERPAYMENT = REJECT, never clamped,
   * never a confirmation flow (unlike `Debt.applyRepayment`'s own
   * confirm-to-cap UX for the sibling concept — a deliberately DIFFERENT
   * rule, per the explicitly approved Stage F decision, not copied from
   * Debt).
   *
   * PARTIAL/IRREGULAR PAYMENTS = ALLOWED — `paymentAmount` is never
   * required to equal `installmentAmount`; no such check exists here.
   *
   * Preserves this entity's own existing invariant
   * (`outstandingBalance == 0 ⟺ status == 'paid_off'`, enforced by the
   * constructor `Loan.validate` already calls) by construction: the
   * returned `Loan`'s `status` is computed from the SAME new balance the
   * constructor will independently re-validate.
   */
  applyPayment(
    paymentAmount: string,
    now: Date = new Date(),
  ): { loan: Loan; principalPortion: string } {
    if (this.status !== 'open') {
      throw new InvalidLoanError(`Cannot apply a payment to a loan with status "${this.status}".`);
    }
    if (!isValidDecimalAmount(paymentAmount)) {
      throw new InvalidLoanError(
        `Payment amount must be a positive decimal value, got "${paymentAmount}".`,
      );
    }

    const principalPortion = computeLoanAmortization({
      outstandingBalance: this.outstandingBalance,
      interestRate: this.interestRate,
      installmentsPerYear: installmentsPerYearFor(this.installmentFrequency),
      paymentAmount,
    });

    if (compareDecimalAmounts(principalPortion, '0') === -1) {
      throw new NegativeAmortizationError(this.id, paymentAmount, principalPortion);
    }
    if (compareDecimalAmounts(principalPortion, this.outstandingBalance) === 1) {
      throw new LoanOverpaymentError(
        this.id,
        paymentAmount,
        principalPortion,
        this.outstandingBalance,
      );
    }

    const newBalance = subtractDecimalAmounts(this.outstandingBalance, principalPortion);
    const newStatus: LoanStatus =
      compareDecimalAmounts(newBalance, '0') === 0 ? 'paid_off' : 'open';

    return {
      loan: new Loan({
        id: this.id,
        userId: this.userId,
        lender: this.lender,
        principalAmount: this.principalAmount,
        outstandingBalance: newBalance,
        currency: this.currency,
        interestRate: this.interestRate,
        installmentAmount: this.installmentAmount,
        installmentFrequency: this.installmentFrequency,
        startDate: this.startDate,
        status: newStatus,
        deletedAt: this.deletedAt,
        createdAt: this.createdAt,
        updatedAt: now,
      }),
      principalPortion,
    };
  }
}
