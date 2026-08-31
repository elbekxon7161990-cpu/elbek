import {
  isNonEmptyString,
  isValidDecimalAmount,
  isValidSignedDecimalAmount,
} from './decimal-amount';
import { InvalidLoanError } from '../errors/invalid-loan.error';

/**
 * TASK-FIN-004 (Stage F, Chapter 8 §8.8, §13.20.3 `loan_payments`) — a
 * single payment applied against an open `Loan`. Deliberately holds no
 * `outstandingBalance` of its own (that lives only on `Loan`, the single
 * source of truth) — an append-only ledger row, not a running total,
 * mirroring `DebtRepayment`'s own identical shape.
 *
 * Deliberately has NO `currency` field (unlike `DebtRepayment`) — the
 * `loan_payments` table genuinely has no such column (confirmed against
 * the schema); a payment is always implicitly in the loan's own currency,
 * a schema-forced constraint, not invented here. Also no `originalText`
 * (the schema has none either) and no `deletedAt` (no soft-delete
 * mechanism exists for a payment — consistent with `DebtRepayment` also
 * having no edit/delete use case ever built).
 */
export interface LoanPaymentProps {
  id: string;
  loanId: string;
  /** CHECK amount > 0 (§13.20.3). */
  amount: string;
  /**
   * §8.14.6 — computed by `computeLoanAmortization` and persisted at write
   * time (FR-DB-003), never recomputed retroactively. Per the approved
   * Stage F product decisions, this is always > 0 and <= the loan's
   * outstandingBalance at write time — `Loan.applyPayment` enforces both
   * before this entity is ever constructed with a real value, but this
   * entity's own validation only checks the shape (a valid decimal), not
   * those business rules — the same "entity owns shape, aggregate root
   * owns cross-field business rules" split `Transaction`/`Account` already
   * establish.
   */
  principalPortion: string;
  paymentDate: Date;
  createdAt: Date;
}

export type NewLoanPaymentValidationProps = Omit<LoanPaymentProps, 'id' | 'createdAt'>;

export class LoanPayment {
  readonly id: string;
  readonly loanId: string;
  readonly amount: string;
  readonly principalPortion: string;
  readonly paymentDate: Date;
  readonly createdAt: Date;

  constructor(props: LoanPaymentProps) {
    LoanPayment.validate(props);
    this.id = props.id;
    this.loanId = props.loanId;
    this.amount = props.amount;
    this.principalPortion = props.principalPortion;
    this.paymentDate = props.paymentDate;
    this.createdAt = props.createdAt;
  }

  private static validate(props: LoanPaymentProps): void {
    if (!isNonEmptyString(props.id)) {
      throw new InvalidLoanError('LoanPayment id is required.');
    }
    if (!isNonEmptyString(props.loanId)) {
      throw new InvalidLoanError('LoanPayment loanId is required.');
    }
    if (!isValidDecimalAmount(props.amount)) {
      throw new InvalidLoanError(
        `LoanPayment amount must be a positive decimal value, got "${props.amount}".`,
      );
    }
    // principal_portion has no DB CHECK constraint (§13.20.3 — confirmed),
    // and per the approved Stage F decisions it must be a decimal value
    // that could theoretically be exactly "0" (an interest-only payment,
    // not rejected by the NEGATIVE AMORTIZATION decision, which only
    // rejects a value BELOW zero) — so this validates shape only (a valid
    // signed-or-zero decimal string), not positivity. The upstream
    // rejection of a genuinely negative value is `Loan.applyPayment`'s job
    // (a business rule), not this shape check.
    if (!isValidSignedDecimalAmount(props.principalPortion)) {
      throw new InvalidLoanError(
        `LoanPayment principalPortion must be a decimal value, got "${props.principalPortion}".`,
      );
    }
    if (!(props.paymentDate instanceof Date) || Number.isNaN(props.paymentDate.getTime())) {
      throw new InvalidLoanError('LoanPayment paymentDate must be a valid Date.');
    }
  }

  /** Validates a not-yet-persisted payment — same invariants the constructor enforces, before any repository write (the atomic-validation lesson). */
  static validateNew(props: NewLoanPaymentValidationProps, now: Date = new Date()): void {
    LoanPayment.validate({ ...props, id: 'pending', createdAt: now });
  }
}
