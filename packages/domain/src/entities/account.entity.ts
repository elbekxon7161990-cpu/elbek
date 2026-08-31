import {
  isNonEmptyString,
  isValidCurrencyCode,
  isValidSignedDecimalAmount,
} from './decimal-amount';
import { InvalidAccountError } from '../errors/invalid-account.error';

/**
 * TASK-FIN-007 (Chapter 8 §8.12 Accounts & Wallets, §13.19.2 `accounts`).
 * FR-FIN-022 — "account" (bank-like holdings) and "wallet" (cash/mobile-
 * payment holdings) are the same underlying concept, distinguished only by
 * `accountType`, never a separate entity — §8.12.1's own "the two terms are
 * used interchangeably in this chapter".
 */
export type AccountType = 'cash' | 'bank_card' | 'mobile_wallet' | 'savings' | 'other';

/**
 * §13.19.2's `status` CHECK (`'active' | 'archived'`) — distinct from
 * `deletedAt`, mirroring the same "status vs. deletedAt are two different
 * lifecycle axes" split `Budget`'s own `status: 'active' | 'paused'` +
 * `deletedAt` already established this task session. FR-FIN-025 — "editing
 * ... and archiving (soft-deleting) an account" equates archiving with
 * this task's own soft-delete action; `deletedAt` is accepted here for
 * defense-in-depth (the domain must never reject a value the DB itself
 * permits) but no TASK-FIN-007 use case actively sets it — only `archive()`
 * (status -> 'archived') is built, matching FR-FIN-025's literal scope.
 */
export type AccountStatus = 'active' | 'archived';

const ACCOUNT_TYPES: readonly AccountType[] = [
  'cash',
  'bank_card',
  'mobile_wallet',
  'savings',
  'other',
];
const ACCOUNT_STATUSES: readonly AccountStatus[] = ['active', 'archived'];

export interface AccountProps {
  id: string;
  userId: string;
  name: string;
  accountType: AccountType;
  currency: string;
  /** CHECK none at the DB layer beyond NUMERIC(18,2) — §8.12.3's own validation table: "Any decimal (may be negative, e.g., a credit-card-style account with an existing balance owed)". Never changes after creation (FR-FIN-026 — corrections go through a `BALANCE_ADJUSTMENT` record, not a `startingBalance` edit). */
  startingBalance: string;
  /** At most one `true` per `(userId, currency)` among non-deleted accounts (`uq_accounts_default_per_currency`, a partial unique index — enforced at the database layer; this entity does not re-derive that invariant itself, the same "DB owns the cross-row constraint, entity owns the single-row shape" split every other entity in this codebase already follows). */
  isDefault: boolean;
  status: AccountStatus;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Shape needed to validate a not-yet-persisted account — `id`/timestamps/`status`/`deletedAt` are persistence-assigned. */
export type NewAccountValidationProps = Omit<
  AccountProps,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'status'
>;

/**
 * §8.12's core aggregate — a user-named label with a running balance
 * derived entirely from transactions the user has already logged
 * (§8.12.1's own "self-reported balance tracking, not open banking
 * integration" scope boundary). Deliberately holds no balance figure of
 * its own — FR-FIN-024 requires the balance to be "recalculated live,
 * never a stale cached figure", via §8.14.2's formula (Stage G of this
 * task, not this entity).
 */
export class Account {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly accountType: AccountType;
  readonly currency: string;
  readonly startingBalance: string;
  readonly isDefault: boolean;
  readonly status: AccountStatus;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: AccountProps) {
    Account.validate(props);
    this.id = props.id;
    this.userId = props.userId;
    this.name = props.name;
    this.accountType = props.accountType;
    this.currency = props.currency;
    this.startingBalance = props.startingBalance;
    this.isDefault = props.isDefault;
    this.status = props.status;
    this.deletedAt = props.deletedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  private static validate(props: AccountProps): void {
    if (!isNonEmptyString(props.id)) {
      throw new InvalidAccountError('Account id is required.');
    }
    if (!isNonEmptyString(props.userId)) {
      throw new InvalidAccountError('Account userId is required.');
    }
    if (!isNonEmptyString(props.name)) {
      throw new InvalidAccountError('Account name is required.');
    }
    if (!ACCOUNT_TYPES.includes(props.accountType)) {
      throw new InvalidAccountError(`Invalid account accountType: "${String(props.accountType)}".`);
    }
    if (!isValidCurrencyCode(props.currency)) {
      throw new InvalidAccountError(
        `currency must be a 3-letter ISO 4217 code, got "${props.currency}".`,
      );
    }
    if (!isValidSignedDecimalAmount(props.startingBalance)) {
      throw new InvalidAccountError(
        `startingBalance must be a decimal value (positive, negative, or zero), got "${props.startingBalance}".`,
      );
    }
    if (typeof props.isDefault !== 'boolean') {
      throw new InvalidAccountError('Account isDefault must be a boolean.');
    }
    if (!ACCOUNT_STATUSES.includes(props.status)) {
      throw new InvalidAccountError(`Invalid account status: "${String(props.status)}".`);
    }
  }

  /** Validates a not-yet-persisted account (`CreateAccountUseCase`, Stage D) without requiring persistence-assigned fields. */
  static validateNew(props: NewAccountValidationProps, now: Date = new Date()): void {
    Account.validate({
      ...props,
      id: 'pending',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  get isArchived(): boolean {
    return this.status === 'archived';
  }

  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }
}
