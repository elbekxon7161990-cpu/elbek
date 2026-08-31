import { isNonEmptyString, isValidCurrencyCode, isValidDecimalAmount } from './decimal-amount';
import { compareCalendarDateOnly } from './calendar-date';
import { InvalidTransactionError } from '../errors/invalid-transaction.error';

/**
 * TASK-FIN-001 (Chapter 8 §8.1 Expense Management, §8.2 Income Management)
 * originally scoped this to only the four transaction types those two
 * sections own. TASK-FIN-004 (Chapter 8 §8.7 Transfer, §8.9 Savings Goal)
 * adds `TRANSFER` and `GOAL_CONTRIBUTION` — see `sourceAccountId`/
 * `destinationAccountId`/`destinationAmount`/`goalId` below for the fields
 * those two types use. The `transactions` table's CHECK constraint
 * (packages/infrastructure/prisma/migrations/20260808000000_init/migration.sql)
 * additionally permits INVESTMENT/SAVINGS/LOAN/INSTALLMENT/SUBSCRIPTION/
 * CURRENCY_EXCHANGE/CASH_WITHDRAWAL/BALANCE_ADJUSTMENT — those remain
 * out of TASK-FIN-004's own scope (Loan is modeled as its own `Loan`/
 * `LoanPayment` aggregate, deliberately standalone from `Transaction` per
 * TASK-FIN-004 Stage A's approved architecture decision) and are not
 * modeled here.
 */
export type TransactionType =
  'EXPENSE' | 'INCOME' | 'SALARY' | 'REFUND' | 'TRANSFER' | 'GOAL_CONTRIBUTION';

const TRANSACTION_TYPES: readonly TransactionType[] = [
  'EXPENSE',
  'INCOME',
  'SALARY',
  'REFUND',
  'TRANSFER',
  'GOAL_CONTRIBUTION',
];

/** §13.4 CHECK (payment_method IN (...)) — shared across every transaction type. */
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'mobile_wallet' | 'other';

const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'cash',
  'card',
  'bank_transfer',
  'mobile_wallet',
  'other',
];

/** §13.4 CHECK (source_type IN (...)). */
export type TransactionSourceType =
  'text' | 'voice' | 'photo' | 'pdf' | 'excel' | 'csv' | 'screenshot' | 'manual' | 'api';

const SOURCE_TYPES: readonly TransactionSourceType[] = [
  'text',
  'voice',
  'photo',
  'pdf',
  'excel',
  'csv',
  'screenshot',
  'manual',
  'api',
];

/** §13.4 CHECK (created_by IN (...)). */
export type TransactionCreatedBy = 'ai' | 'user_manual' | 'import' | 'api';

const CREATED_BY_VALUES: readonly TransactionCreatedBy[] = ['ai', 'user_manual', 'import', 'api'];

/** Per-field + overall extraction confidence (Chapter 4 §4.6); exact shape finalized by TASK-AI-001. */
export type TransactionConfidenceScores = Record<string, number>;

/**
 * Calendar-date-only comparison in UTC (see `compareCalendarDateOnly`).
 * BR-EXP-002 actually requires "not in the future in the user's timezone" —
 * this entity has no access to `User.timezone`, so full timezone-aware
 * enforcement is an application-layer concern (a later part, once both
 * entities are in scope together). This is a conservative UTC-calendar-date
 * baseline in the meantime.
 */
function isFutureDate(transactionDate: Date, now: Date): boolean {
  return compareCalendarDateOnly(transactionDate, now) === 1;
}

export interface TransactionProps {
  id: string;
  userId: string;
  transactionType: TransactionType;
  /** Canonical decimal string (e.g. "45000.00"); CHECK amount > 0 (FR-EXP-002). */
  amount: string;
  /** ISO 4217 alpha-3 code; existence against the `currencies` table is an application-layer concern (FR-EXP-003). */
  currency: string;
  exchangeRateToDefault: string | null;
  /**
   * TASK-FIN-007 (Stage E, FR-FIN-023) — the account/wallet the money moved
   * from or to. `null` is a valid, persisted state (the DB column is
   * nullable) but every production caller (`CreateExpenseUseCase`/
   * `CreateIncomeUseCase`) always resolves a concrete value before calling
   * `TransactionRepository.create()` — omitted input resolves to the user's
   * implicit default account (§8.12.4), never a bare `null` write.
   */
  accountId: string | null;
  /**
   * TASK-FIN-004 (FR-FIN-004, §8.7) — the account a `TRANSFER` moves money
   * OUT of. Required (non-null) when `transactionType === 'TRANSFER'`,
   * forbidden (must be `null`) for every other type — a `TRANSFER` uses
   * `sourceAccountId`/`destinationAccountId` instead of `accountId`, never
   * both.
   */
  sourceAccountId: string | null;
  /** TASK-FIN-004 (FR-FIN-004, §8.7) — the account a `TRANSFER` moves money INTO. Same required-for-TRANSFER-only rule as `sourceAccountId`. */
  destinationAccountId: string | null;
  /**
   * TASK-FIN-004 (FR-FIN-005, §8.7) — for a cross-currency `TRANSFER`, the
   * amount as received in the destination account's own currency (`amount`/
   * `currency` above always describe the SOURCE side). Only meaningful for
   * `TRANSFER`; forbidden (must be `null`) for every other type. Whether a
   * given transfer actually needs this populated depends on the two
   * accounts' currencies, which this entity has no visibility into — that
   * determination is an application-layer concern (TASK-FIN-004 Stage D),
   * this entity only enforces the field's own shape when present.
   */
  destinationAmount: string | null;
  /**
   * TASK-FIN-004 (FR-FIN-012, §8.9) — links this transaction to a
   * `SavingsGoal`. Required (non-null) when
   * `transactionType === 'GOAL_CONTRIBUTION'` (a standalone contribution
   * record). Optional on `TRANSFER` (the "linked transfer" contribution
   * mode approved in Stage A — a real transfer between two of the user's own
   * accounts that ALSO counts toward a goal's progress, per §8.14.5).
   * Forbidden (must be `null`) for EXPENSE/INCOME/SALARY/REFUND. A single
   * transaction is never both a standalone `GOAL_CONTRIBUTION` and a
   * goal-linked `TRANSFER` at once — the two contribution modes are
   * mutually exclusive by construction (mutually exclusive `transactionType`
   * values), never a double-counted combination.
   */
  goalId: string | null;
  categoryId: string;
  subcategoryId: string | null;
  merchant: string | null;
  paymentMethod: PaymentMethod | null;
  /** Calendar date only (§13.4 `DATE`); see `isFutureDate` doc for BR-EXP-002 scope. */
  transactionDate: Date;
  /** "HH:MM:SS" (§13.4 `TIME`) — no date/timezone component. */
  transactionTime: string | null;
  location: string | null;
  tags: string[];
  description: string;
  originalText: string;
  sourceType: TransactionSourceType;
  sourceReference: string | null;
  confidenceScores: TransactionConfidenceScores | null;
  isRecurringDetected: boolean;
  linkedTransactionId: string | null;
  createdBy: TransactionCreatedBy;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Fields `Transaction.create`/`.edit` (TASK-FIN-001 Part 2) allow the
 * application layer to set on a not-yet-persisted or being-edited
 * transaction — persistence-assigned fields (id/timestamps/deletedAt) and
 * provenance/pipeline fields (transactionType, sourceType, originalText,
 * createdBy, confidenceScores, linkedTransactionId, isRecurringDetected,
 * exchangeRateToDefault) are excluded on purpose (FR-EXP-005 names exactly
 * this field set; everything else is write-once).
 *
 * TASK-FIN-004 (FR-FIN-006) — `accountId`/`sourceAccountId`/
 * `destinationAccountId` remain permanently excluded, by direct symmetry
 * with `accountId`'s own already-established write-once precedent: a
 * `TRANSFER`'s two accounts can only be set at creation; correcting them
 * requires delete + recreate, not `edit()` (an explicit product decision,
 * not an accident of the type — see this task's own final report for the
 * three decisions that shaped this field set).
 *
 * `destinationAmount` is the one addition beyond FR-EXP-005's original set,
 * and is NOT a freely, independently editable field the way `amount`/
 * `currency` are — `Transaction.edit()` itself rejects any attempt to touch
 * it without ALSO touching `amount` or `currency` in the same call (see
 * `edit()`'s own doc comment). It exists here only so a `TRANSFER` edit that
 * changes `amount` or `currency` can re-state (or explicitly clear, via
 * `null`) the destination-side value in the SAME call — required because
 * editing either of those two fields can make a previously-captured
 * `destinationAmount` stale or newly-necessary. The full cross-currency
 * consistency check (comparing against the destination account's real
 * currency) needs `AccountRepository` access this entity doesn't have — see
 * `EditTransactionUseCase` for that half.
 */
export interface TransactionEditableFields {
  amount: string;
  currency: string;
  categoryId: string;
  subcategoryId: string | null;
  merchant: string | null;
  paymentMethod: PaymentMethod | null;
  transactionDate: Date;
  location: string | null;
  tags: string[];
  description: string;
  /** TASK-FIN-004 (FR-FIN-006) — TRANSFER only; see the interface's own doc comment above. */
  destinationAmount: string | null;
}

/**
 * Shape needed to validate a not-yet-persisted transaction (no id/timestamps
 * assigned yet). Used by application-layer use cases (TASK-FIN-001 Part 2,
 * `Transaction.validateNew`) to enforce domain invariants — including
 * BR-EXP-002's future-date rule, which has no equivalent database CHECK
 * constraint — before calling `TransactionRepository.create()`.
 */
export type NewTransactionValidationProps = Omit<
  TransactionProps,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/**
 * Mirrors the `transactions` table's core columns (Chapter 13 §13.4,
 * packages/infrastructure/prisma/schema.prisma's `Transaction` model) for the
 * four types Chapter 8 §8.1/§8.2 own. Unlike `User`, this entity enforces its
 * own invariants at construction and state-transition time — TASK-FIN-001
 * explicitly asks for domain-owned validation (amount, type, date, required
 * fields) that `User` didn't previously need.
 */
export class Transaction {
  readonly id: string;
  readonly userId: string;
  readonly transactionType: TransactionType;
  readonly amount: string;
  readonly currency: string;
  readonly exchangeRateToDefault: string | null;
  readonly accountId: string | null;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
  readonly destinationAmount: string | null;
  readonly goalId: string | null;
  readonly categoryId: string;
  readonly subcategoryId: string | null;
  readonly merchant: string | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly transactionDate: Date;
  readonly transactionTime: string | null;
  readonly location: string | null;
  readonly tags: readonly string[];
  readonly description: string;
  readonly originalText: string;
  readonly sourceType: TransactionSourceType;
  readonly sourceReference: string | null;
  readonly confidenceScores: TransactionConfidenceScores | null;
  readonly isRecurringDetected: boolean;
  readonly linkedTransactionId: string | null;
  readonly createdBy: TransactionCreatedBy;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  /**
   * @param now Reference "current time" used for `createdAt`/`updatedAt`
   *   defaults elsewhere in this class — never shifted for timezone
   *   purposes, always a true system instant.
   * @param referenceLocalDate BR-EXP-002's actual comparison point for the
   *   not-future-dated check: "today" as calculated in the *user's*
   *   timezone, not server UTC. Defaults to `now` (this entity has no
   *   access to `User.timezone` — computing this value from a real user
   *   timezone is an application-layer concern, `@afa/application`'s
   *   `resolveUserLocalReferenceDate`), so a caller that doesn't pass this
   *   explicitly gets exactly the previous UTC-calendar-date behavior.
   */
  constructor(props: TransactionProps, now: Date = new Date(), referenceLocalDate: Date = now) {
    Transaction.validate(props, now, referenceLocalDate);

    this.id = props.id;
    this.userId = props.userId;
    this.transactionType = props.transactionType;
    this.amount = props.amount;
    this.currency = props.currency;
    this.exchangeRateToDefault = props.exchangeRateToDefault;
    this.accountId = props.accountId;
    this.sourceAccountId = props.sourceAccountId;
    this.destinationAccountId = props.destinationAccountId;
    this.destinationAmount = props.destinationAmount;
    this.goalId = props.goalId;
    this.categoryId = props.categoryId;
    this.subcategoryId = props.subcategoryId;
    this.merchant = props.merchant;
    this.paymentMethod = props.paymentMethod;
    this.transactionDate = props.transactionDate;
    this.transactionTime = props.transactionTime;
    this.location = props.location;
    this.tags = props.tags;
    this.description = props.description;
    this.originalText = props.originalText;
    this.sourceType = props.sourceType;
    this.sourceReference = props.sourceReference;
    this.confidenceScores = props.confidenceScores;
    this.isRecurringDetected = props.isRecurringDetected;
    this.linkedTransactionId = props.linkedTransactionId;
    this.createdBy = props.createdBy;
    this.deletedAt = props.deletedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  private static validate(
    props: TransactionProps,
    now: Date,
    referenceLocalDate: Date = now,
  ): void {
    if (!isNonEmptyString(props.id)) {
      throw new InvalidTransactionError('Transaction id is required.');
    }
    if (!isNonEmptyString(props.userId)) {
      throw new InvalidTransactionError('Transaction userId is required.');
    }
    if (!TRANSACTION_TYPES.includes(props.transactionType)) {
      throw new InvalidTransactionError(
        `Invalid transaction type: "${String(props.transactionType)}".`,
      );
    }
    if (!isValidDecimalAmount(props.amount)) {
      throw new InvalidTransactionError(
        `amount must be a positive decimal value, got "${props.amount}".`,
      );
    }
    if (!isValidCurrencyCode(props.currency)) {
      throw new InvalidTransactionError(
        `currency must be a 3-letter ISO 4217 code, got "${props.currency}".`,
      );
    }
    if (props.accountId !== null && !isNonEmptyString(props.accountId)) {
      throw new InvalidTransactionError('Transaction accountId, when provided, must be non-empty.');
    }
    if (props.sourceAccountId !== null && !isNonEmptyString(props.sourceAccountId)) {
      throw new InvalidTransactionError(
        'Transaction sourceAccountId, when provided, must be non-empty.',
      );
    }
    if (props.destinationAccountId !== null && !isNonEmptyString(props.destinationAccountId)) {
      throw new InvalidTransactionError(
        'Transaction destinationAccountId, when provided, must be non-empty.',
      );
    }
    if (props.destinationAmount !== null && !isValidDecimalAmount(props.destinationAmount)) {
      throw new InvalidTransactionError(
        `destinationAmount, when provided, must be a positive decimal value, got "${props.destinationAmount}".`,
      );
    }
    if (props.goalId !== null && !isNonEmptyString(props.goalId)) {
      throw new InvalidTransactionError('Transaction goalId, when provided, must be non-empty.');
    }
    // TASK-FIN-004 (FR-FIN-004/FR-FIN-006, §8.7) — a TRANSFER moves money
    // between two of the user's own accounts via sourceAccountId/
    // destinationAccountId, never accountId (that field is EXPENSE/INCOME/
    // SALARY/REFUND/GOAL_CONTRIBUTION's own attribution mechanism, §8.12.2).
    // BR-FIN-002 (both accounts belong to the same user) is NOT checked
    // here — this entity has no visibility into `Account` records; that
    // ownership check is an application-layer concern (TASK-FIN-004 Stage D,
    // via `AccountRepository`), same boundary `resolve-transaction-account-id.ts`
    // already draws for EXPENSE/INCOME's own accountId.
    if (props.transactionType === 'TRANSFER') {
      if (props.accountId !== null) {
        throw new InvalidTransactionError(
          'A TRANSFER must not set accountId; use sourceAccountId/destinationAccountId instead.',
        );
      }
      if (props.sourceAccountId === null) {
        throw new InvalidTransactionError('A TRANSFER requires sourceAccountId.');
      }
      if (props.destinationAccountId === null) {
        throw new InvalidTransactionError('A TRANSFER requires destinationAccountId.');
      }
      // §8.7.5 edge case / AC-FIN-007 — rejected outright, never a silent no-op.
      if (props.sourceAccountId === props.destinationAccountId) {
        throw new InvalidTransactionError(
          'A TRANSFER must not use the same account as both source and destination.',
        );
      }
    } else {
      if (props.sourceAccountId !== null) {
        throw new InvalidTransactionError(
          `sourceAccountId is only valid on a TRANSFER, not "${props.transactionType}".`,
        );
      }
      if (props.destinationAccountId !== null) {
        throw new InvalidTransactionError(
          `destinationAccountId is only valid on a TRANSFER, not "${props.transactionType}".`,
        );
      }
      if (props.destinationAmount !== null) {
        throw new InvalidTransactionError(
          `destinationAmount is only valid on a TRANSFER, not "${props.transactionType}".`,
        );
      }
    }
    // TASK-FIN-004 (FR-FIN-011/FR-FIN-012, §8.9) — a standalone
    // GOAL_CONTRIBUTION always names its goal; a TRANSFER may OPTIONALLY
    // link one (the approved "linked transfer" contribution mode — a real
    // transfer that also counts toward goal progress, §8.14.5); every other
    // type must never carry a goalId, keeping the two contribution modes
    // mutually exclusive by construction (never a double-counted pair for
    // the same money movement, FR-FIN-012).
    if (props.transactionType === 'GOAL_CONTRIBUTION' && props.goalId === null) {
      throw new InvalidTransactionError('A GOAL_CONTRIBUTION requires goalId.');
    }
    if (
      props.goalId !== null &&
      props.transactionType !== 'GOAL_CONTRIBUTION' &&
      props.transactionType !== 'TRANSFER'
    ) {
      throw new InvalidTransactionError(
        `goalId is only valid on GOAL_CONTRIBUTION or TRANSFER, not "${props.transactionType}".`,
      );
    }
    if (!isNonEmptyString(props.categoryId)) {
      throw new InvalidTransactionError('Transaction categoryId is required.');
    }
    if (!isNonEmptyString(props.description)) {
      throw new InvalidTransactionError('Transaction description is required.');
    }
    if (!isNonEmptyString(props.originalText)) {
      throw new InvalidTransactionError('Transaction originalText is required.');
    }
    if (!SOURCE_TYPES.includes(props.sourceType)) {
      throw new InvalidTransactionError(`Invalid source type: "${String(props.sourceType)}".`);
    }
    if (!CREATED_BY_VALUES.includes(props.createdBy)) {
      throw new InvalidTransactionError(`Invalid createdBy value: "${String(props.createdBy)}".`);
    }
    if (props.paymentMethod !== null && !PAYMENT_METHODS.includes(props.paymentMethod)) {
      throw new InvalidTransactionError(
        `Invalid payment method: "${String(props.paymentMethod)}".`,
      );
    }
    // BR-EXP-002 — backdated/same-day only, never future-dated, evaluated
    // against `referenceLocalDate` (the user's own local calendar date when
    // the caller supplies one; server UTC date otherwise — see the
    // constructor's own doc comment).
    if (isFutureDate(props.transactionDate, referenceLocalDate)) {
      throw new InvalidTransactionError('Transaction date cannot be in the future.');
    }
  }

  /**
   * Validates a not-yet-persisted transaction's field values (TASK-FIN-001
   * Part 2's Create Expense/Income use cases) without requiring
   * persistence-assigned fields. Throws `InvalidTransactionError` on any
   * violation — the same invariants the constructor enforces.
   */
  static validateNew(
    props: NewTransactionValidationProps,
    now: Date = new Date(),
    referenceLocalDate: Date = now,
  ): void {
    Transaction.validate(
      { ...props, id: 'pending', createdAt: now, updatedAt: now, deletedAt: null },
      now,
      referenceLocalDate,
    );
  }

  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  /** FR-EXP-006 — soft-delete, recoverable (never a hard delete from a user-facing action). */
  delete(now: Date = new Date()): Transaction {
    if (this.isDeleted) {
      throw new InvalidTransactionError('Transaction is already deleted.');
    }
    return new Transaction({ ...this.toProps(), deletedAt: now, updatedAt: now }, now);
  }

  /** AC-EXP-003 — `/undo` restores a deleted transaction with all original field values intact. */
  restore(now: Date = new Date()): Transaction {
    if (!this.isDeleted) {
      throw new InvalidTransactionError('Transaction is not deleted.');
    }
    return new Transaction({ ...this.toProps(), deletedAt: null, updatedAt: now }, now);
  }

  /**
   * FR-EXP-005 — edits any subset of `TransactionEditableFields` and
   * re-validates the merged result (amount/currency/date/etc. invariants all
   * re-run). `transactionType` is not part of `TransactionEditableFields`,
   * so it can never be silently changed through this method.
   *
   * TASK-FIN-004 (FR-FIN-006) adds two TRANSFER-specific guards, both pure
   * structural checks this entity can make without any `AccountRepository`
   * access (the account-aware cross-currency consistency check lives in
   * `EditTransactionUseCase` instead — see `TransactionEditableFields`'s own
   * doc comment):
   *
   * 1. A goal-linked TRANSFER (one that also contributes to a `SavingsGoal`,
   *    the FR-FIN-012 "linked transfer" mode) can never be edited through
   *    this stage — no mechanism exists yet to reverse/reconcile the goal's
   *    progress/milestone state against an edited contribution amount, and
   *    silently leaving that state stale would be worse than rejecting the
   *    edit outright. Deliberately checked first, before any other rule.
   * 2. `destinationAmount` can never be the ONLY field touched by an edit —
   *    it may only be re-stated (or explicitly cleared via `null`) in the
   *    SAME call that also changes `amount` or `currency`, since those are
   *    the only two fields whose edit can make a previously-captured
   *    `destinationAmount` stale or newly-necessary.
   */
  edit(
    changes: Partial<TransactionEditableFields>,
    now: Date = new Date(),
    referenceLocalDate: Date = now,
  ): Transaction {
    if (this.isDeleted) {
      throw new InvalidTransactionError('Cannot edit a deleted transaction.');
    }
    if (this.transactionType === 'TRANSFER') {
      if (this.goalId !== null) {
        throw new InvalidTransactionError(
          'Cannot edit a goal-linked TRANSFER; editing a transfer that also contributes to a savings goal is not supported.',
        );
      }
      if (
        changes.destinationAmount !== undefined &&
        changes.amount === undefined &&
        changes.currency === undefined
      ) {
        throw new InvalidTransactionError(
          'destinationAmount cannot be edited independently of amount or currency on a TRANSFER.',
        );
      }
    }
    return new Transaction(
      { ...this.toProps(), ...changes, updatedAt: now },
      now,
      referenceLocalDate,
    );
  }

  private toProps(): TransactionProps {
    return {
      id: this.id,
      userId: this.userId,
      transactionType: this.transactionType,
      amount: this.amount,
      currency: this.currency,
      exchangeRateToDefault: this.exchangeRateToDefault,
      accountId: this.accountId,
      sourceAccountId: this.sourceAccountId,
      destinationAccountId: this.destinationAccountId,
      destinationAmount: this.destinationAmount,
      goalId: this.goalId,
      categoryId: this.categoryId,
      subcategoryId: this.subcategoryId,
      merchant: this.merchant,
      paymentMethod: this.paymentMethod,
      transactionDate: this.transactionDate,
      transactionTime: this.transactionTime,
      location: this.location,
      tags: [...this.tags],
      description: this.description,
      originalText: this.originalText,
      sourceType: this.sourceType,
      sourceReference: this.sourceReference,
      confidenceScores: this.confidenceScores,
      isRecurringDetected: this.isRecurringDetected,
      linkedTransactionId: this.linkedTransactionId,
      createdBy: this.createdBy,
      deletedAt: this.deletedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
