import {
  compareDecimalAmounts,
  isNonEmptyString,
  isValidCurrencyCode,
  isValidDecimalAmount,
  isValidNonNegativeDecimalAmount,
  subtractDecimalAmounts,
} from './decimal-amount';
import { compareCalendarDateOnly } from './calendar-date';
import { DebtOverpaymentError } from '../errors/debt-overpayment.error';
import { InvalidDebtError } from '../errors/invalid-debt.error';

/**
 * TASK-FIN-002 (Chapter 8 §8.3 Debt Management, §13.6 `debts`).
 * FR-DBT-001 — DEBT_GIVEN ("I lent money") / DEBT_RECEIVED ("I borrowed
 * money"); this task's own P0 scope is interest-free debts only
 * (FR-DBT-009) — an interest mention, if present, is stored verbatim in
 * `notes`, never calculated over.
 */
export type DebtDirection = 'given' | 'received';

/** `'forgiven'` (FR-DBT-005, P1 explicit forgive/settle) is distinct from `'repaid'` (paid off in full via one or more `DebtRepayment`s) — both are terminal, but only `'repaid'` implies `outstandingBalance === '0'` was reached through real repayments. */
export type DebtStatus = 'open' | 'repaid' | 'forgiven';

const DEBT_DIRECTIONS: readonly DebtDirection[] = ['given', 'received'];
const DEBT_STATUSES: readonly DebtStatus[] = ['open', 'repaid', 'forgiven'];

export interface DebtProps {
  id: string;
  userId: string;
  direction: DebtDirection;
  /** Free-text name as given by the user (§8.3.6) — always populated, even once `counterpartyRefId` resolves to a real `Counterparty` row. */
  counterpartyName: string;
  /** Resolved `Counterparty.id`, or `null` if not yet linked to a resolved counterparty record. */
  counterpartyRefId: string | null;
  /** CHECK original_amount > 0 (§13.6). Never changes after creation. */
  originalAmount: string;
  /** CHECK outstanding_balance >= 0 (§13.6, BR-DBT-001) — decreases via repayments, reaches 0 exactly when `status` becomes `'repaid'`. */
  outstandingBalance: string;
  currency: string;
  transactionDate: Date;
  dueDate: Date | null;
  status: DebtStatus;
  /** FR-DBT-009 — an interest mention, if present, is stored here verbatim; never parsed or calculated over (interest-free MVP). */
  notes: string | null;
  originalText: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Shape needed to validate a not-yet-persisted debt. `outstandingBalance`/
 * `status` are excluded on purpose — a brand-new debt always starts fully
 * outstanding and `'open'` (§8.3.6); no caller ever supplies either
 * directly, so there is no way to construct an inconsistent starting state.
 */
export type NewDebtValidationProps = Omit<
  DebtProps,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'outstandingBalance' | 'status'
>;

/**
 * §8.3's core aggregate. Enforces BR-DBT-001 (outstanding balance never
 * negative, never exceeds the original amount) at construction time, in
 * addition to the database's own `CHECK outstanding_balance >= 0` — the
 * same defense-in-depth relationship `Transaction`'s domain validation has
 * with its own table's CHECK constraints.
 */
export class Debt {
  readonly id: string;
  readonly userId: string;
  readonly direction: DebtDirection;
  readonly counterpartyName: string;
  readonly counterpartyRefId: string | null;
  readonly originalAmount: string;
  readonly outstandingBalance: string;
  readonly currency: string;
  readonly transactionDate: Date;
  readonly dueDate: Date | null;
  readonly status: DebtStatus;
  readonly notes: string | null;
  readonly originalText: string;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: DebtProps) {
    Debt.validate(props);
    this.id = props.id;
    this.userId = props.userId;
    this.direction = props.direction;
    this.counterpartyName = props.counterpartyName;
    this.counterpartyRefId = props.counterpartyRefId;
    this.originalAmount = props.originalAmount;
    this.outstandingBalance = props.outstandingBalance;
    this.currency = props.currency;
    this.transactionDate = props.transactionDate;
    this.dueDate = props.dueDate;
    this.status = props.status;
    this.notes = props.notes;
    this.originalText = props.originalText;
    this.deletedAt = props.deletedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /**
   * Standing invariants only — checked on EVERY reconstruction, including
   * reading an existing (possibly overdue) row back from the database.
   * Deliberately does NOT check `dueDate` against "now": an open debt whose
   * due date has already passed is a normal, expected state (that is what
   * "overdue" means) — rejecting it here would make it impossible to ever
   * read an overdue debt back out of the repository. The one-time "due date
   * must not already be in the past" rule (§8.3.6) is a CREATION-time-only
   * check — see `validateNew` below, deliberately not duplicated here. This
   * is the same category of distinction `Transaction`'s own `isFutureDate`
   * check does NOT need to make (a transaction date is never legitimately
   * "in the future" at any later read, unlike a due date, which legitimately
   * becomes past-dated over time).
   */
  private static validate(props: DebtProps): void {
    if (!isNonEmptyString(props.id)) {
      throw new InvalidDebtError('Debt id is required.');
    }
    if (!isNonEmptyString(props.userId)) {
      throw new InvalidDebtError('Debt userId is required.');
    }
    if (!DEBT_DIRECTIONS.includes(props.direction)) {
      throw new InvalidDebtError(`Invalid debt direction: "${String(props.direction)}".`);
    }
    // BR-DBT-002 — debts are strictly scoped to the user's own
    // counterparties; a name is always required even before/instead of a
    // resolved `counterpartyRefId`.
    if (!isNonEmptyString(props.counterpartyName)) {
      throw new InvalidDebtError('Debt counterpartyName is required.');
    }
    if (!isValidDecimalAmount(props.originalAmount)) {
      throw new InvalidDebtError(
        `originalAmount must be a positive decimal value, got "${props.originalAmount}".`,
      );
    }
    if (!isValidNonNegativeDecimalAmount(props.outstandingBalance)) {
      throw new InvalidDebtError(
        `outstandingBalance must be a non-negative decimal value, got "${props.outstandingBalance}".`,
      );
    }
    // BR-DBT-001's "never negative" is enforced by isValidNonNegativeDecimalAmount
    // above; this additional check enforces the other half of the same
    // invariant family — outstanding can never exceed what the debt started
    // at, a state no valid sequence of repayments/creation can produce.
    if (compareDecimalAmounts(props.outstandingBalance, props.originalAmount) === 1) {
      throw new InvalidDebtError('outstandingBalance cannot exceed originalAmount.');
    }
    if (!isValidCurrencyCode(props.currency)) {
      throw new InvalidDebtError(
        `currency must be a 3-letter ISO 4217 code, got "${props.currency}".`,
      );
    }
    if (!isNonEmptyString(props.originalText)) {
      throw new InvalidDebtError('Debt originalText is required.');
    }
    if (!DEBT_STATUSES.includes(props.status)) {
      throw new InvalidDebtError(`Invalid debt status: "${String(props.status)}".`);
    }
    // status<->balance consistency: 'repaid' must mean exactly zero
    // outstanding, and zero outstanding on an 'open' debt is a contradiction
    // in terms (it should have already transitioned to 'repaid').
    const isZeroBalance = compareDecimalAmounts(props.outstandingBalance, '0') === 0;
    if (props.status === 'repaid' && !isZeroBalance) {
      throw new InvalidDebtError('A "repaid" debt must have a zero outstandingBalance.');
    }
    if (props.status === 'open' && isZeroBalance) {
      throw new InvalidDebtError('An "open" debt cannot have a zero outstandingBalance.');
    }
  }

  /**
   * Validates a not-yet-persisted debt (TASK-FIN-002's Create Debt use
   * case) without requiring persistence-assigned fields — the same
   * invariants the constructor enforces, plus the one CREATION-time-only
   * rule the constructor deliberately excludes (see its own doc comment):
   * §8.3.6 — "a due date in the past at creation is flagged as likely a
   * mis-extraction."
   */
  static validateNew(props: NewDebtValidationProps, now: Date = new Date()): void {
    Debt.validate({
      ...props,
      id: 'pending',
      outstandingBalance: props.originalAmount,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    if (props.dueDate !== null && compareCalendarDateOnly(props.dueDate, now) === -1) {
      throw new InvalidDebtError('Due date cannot be in the past.');
    }
  }

  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  /**
   * TASK-FIN-008 (§8.14.6 `debt_outstanding_balance`) — the pre-check half
   * of this formula's authoritative implementation; see
   * `PrismaDebtRepository.logRepayment`'s own doc comment for the
   * atomic-write half and why Debt's decrement-on-write shape (vs. the
   * other §8.14 formulas' live-recompute shape) is a deliberate, approved
   * divergence, not something this task silently reconciled.
   *
   * Pure arithmetic + invariant check (BR-DBT-001). Used both directly by
   * domain tests verifying the balance/status transition in isolation, and
   * by the application layer as a pre-check — deciding whether to proceed
   * or ask for overpayment confirmation — before calling
   * `DebtRepository.logRepayment`'s own atomic SQL update, which
   * independently re-enforces the same invariant at the database layer
   * (defense in depth, the same relationship TASK-BOT-007-FIX's conditional
   * `UPDATE ... WHERE` has with its own caller).
   *
   * Throws `DebtOverpaymentError` (not `InvalidDebtError`) when `amount`
   * exceeds the outstanding balance — a distinct, catchable signal the
   * application layer uses to drive BR-DBT-001's "overpayment requires
   * confirmation" flow, never to reject outright.
   */
  applyRepayment(amount: string, now: Date = new Date()): Debt {
    if (this.status !== 'open') {
      throw new InvalidDebtError(
        `Cannot apply a repayment to a debt with status "${this.status}".`,
      );
    }
    if (!isValidDecimalAmount(amount)) {
      throw new InvalidDebtError(
        `Repayment amount must be a positive decimal value, got "${amount}".`,
      );
    }
    if (compareDecimalAmounts(amount, this.outstandingBalance) === 1) {
      throw new DebtOverpaymentError(this.id, amount, this.outstandingBalance);
    }
    const newBalance = subtractDecimalAmounts(this.outstandingBalance, amount);
    const newStatus: DebtStatus = compareDecimalAmounts(newBalance, '0') === 0 ? 'repaid' : 'open';
    return new Debt({
      ...this.toProps(),
      outstandingBalance: newBalance,
      status: newStatus,
      updatedAt: now,
    });
  }

  /** FR-DBT-005 (P1) — explicit forgive/settle, distinct from `'repaid'`: the outstanding balance is written off, not paid down. */
  forgive(now: Date = new Date()): Debt {
    if (this.status !== 'open') {
      throw new InvalidDebtError(`Cannot forgive a debt with status "${this.status}".`);
    }
    return new Debt({ ...this.toProps(), status: 'forgiven', updatedAt: now });
  }

  private toProps(): DebtProps {
    return {
      id: this.id,
      userId: this.userId,
      direction: this.direction,
      counterpartyName: this.counterpartyName,
      counterpartyRefId: this.counterpartyRefId,
      originalAmount: this.originalAmount,
      outstandingBalance: this.outstandingBalance,
      currency: this.currency,
      transactionDate: this.transactionDate,
      dueDate: this.dueDate,
      status: this.status,
      notes: this.notes,
      originalText: this.originalText,
      deletedAt: this.deletedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
