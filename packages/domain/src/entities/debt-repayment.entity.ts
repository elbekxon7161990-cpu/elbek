import { isNonEmptyString, isValidCurrencyCode, isValidDecimalAmount } from './decimal-amount';
import { InvalidDebtError } from '../errors/invalid-debt.error';

/**
 * TASK-FIN-002 (Chapter 8 §8.3, §13.6 `debt_repayments`) — a single payment
 * applied against an open `Debt`. Deliberately holds no `outstandingBalance`
 * of its own (that lives only on `Debt`, the single source of truth) —
 * this entity is an append-only ledger row, not a running total.
 */
export interface DebtRepaymentProps {
  id: string;
  debtId: string;
  /** CHECK amount > 0 (§13.6) — a repayment of exactly 0 is meaningless and never valid. */
  amount: string;
  currency: string;
  repaymentDate: Date;
  originalText: string;
  deletedAt: Date | null;
  createdAt: Date;
}

/** Shape needed to validate a not-yet-persisted repayment (no id/createdAt assigned yet). */
export type NewDebtRepaymentValidationProps = Omit<
  DebtRepaymentProps,
  'id' | 'createdAt' | 'deletedAt'
>;

export class DebtRepayment {
  readonly id: string;
  readonly debtId: string;
  readonly amount: string;
  readonly currency: string;
  readonly repaymentDate: Date;
  readonly originalText: string;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;

  constructor(props: DebtRepaymentProps) {
    DebtRepayment.validate(props);
    this.id = props.id;
    this.debtId = props.debtId;
    this.amount = props.amount;
    this.currency = props.currency;
    this.repaymentDate = props.repaymentDate;
    this.originalText = props.originalText;
    this.deletedAt = props.deletedAt;
    this.createdAt = props.createdAt;
  }

  private static validate(props: DebtRepaymentProps): void {
    if (!isNonEmptyString(props.id)) {
      throw new InvalidDebtError('DebtRepayment id is required.');
    }
    if (!isNonEmptyString(props.debtId)) {
      throw new InvalidDebtError('DebtRepayment debtId is required.');
    }
    if (!isValidDecimalAmount(props.amount)) {
      throw new InvalidDebtError(
        `DebtRepayment amount must be a positive decimal value, got "${props.amount}".`,
      );
    }
    if (!isValidCurrencyCode(props.currency)) {
      throw new InvalidDebtError(
        `currency must be a 3-letter ISO 4217 code, got "${props.currency}".`,
      );
    }
    if (!isNonEmptyString(props.originalText)) {
      throw new InvalidDebtError('DebtRepayment originalText is required.');
    }
  }

  /** Validates a not-yet-persisted repayment — same invariants the constructor enforces, before any repository write (the atomic-validation lesson: validate before writing, never after). */
  static validateNew(props: NewDebtRepaymentValidationProps, now: Date = new Date()): void {
    DebtRepayment.validate({ ...props, id: 'pending', createdAt: now, deletedAt: null });
  }
}
