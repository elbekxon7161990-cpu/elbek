import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountRepository,
  CategoryRepository,
  CurrencyRepository,
  Transaction,
  TransactionAuditLogRepository,
  TransactionRepository,
  UserRepository,
} from '@afa/domain';
import {
  ACCOUNT_REPOSITORY,
  CATEGORY_REPOSITORY,
  CURRENCY_REPOSITORY,
  TRANSACTION_AUDIT_LOG_REPOSITORY,
  TRANSACTION_REPOSITORY,
  USER_REPOSITORY,
} from '@afa/domain';

import type { EditTransactionInput } from '../dto/edit-transaction.input';
import { AccountNotFoundError } from '../errors/account-not-found.error';
import { InvalidDestinationAmountEditError } from '../errors/invalid-destination-amount-edit.error';
import { MissingDestinationAmountError } from '../errors/missing-destination-amount.error';
import { TransactionAlreadyDeletedError } from '../errors/transaction-already-deleted.error';
import { TransactionNotFoundError } from '../errors/transaction-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';
import { UnauthorizedTransactionAccessError } from '../errors/unauthorized-transaction-access.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { computeTransactionFieldDiffs } from './compute-transaction-field-diffs';
import { resolveUserLocalReferenceDate } from './resolve-user-local-reference-date';
import { validateTransactionReferences } from './validate-transaction-references';

/**
 * FR-EXP-005 — edits any subset of `TransactionEditableFields`
 * (amount/currency/category/subcategory/merchant/payment method/date/
 * location/tags/description). `transactionType` is not editable through
 * this use case since it isn't part of that field set (FR-EXP-005 never
 * lists it, and reclassifying EXPENSE↔INCOME isn't "editing a field" per the
 * spec's own framing).
 *
 * FR-EXP-007 — every changed field is recorded to `transaction_audit_log`
 * via `TransactionAuditLogRepository`; unchanged fields never generate a row.
 *
 * BR-EXP-002 — when `transactionDate` is among the edited fields, the
 * not-future-dated re-check uses the owning user's own timezone (looked up
 * only in that case, to avoid an unnecessary user lookup on every edit).
 *
 * TASK-FIN-004 (FR-FIN-006) — for a TRANSFER whose edit touches `amount`,
 * `currency`, or `destinationAmount`, this use case additionally re-derives
 * cross-currency status against the destination account's REAL currency
 * (`AccountRepository`, unavailable to `Transaction.edit()` itself) and
 * rejects an edit that would leave `destinationAmount` inconsistent with
 * that status — see `execute()`'s own inline comment for the exact rule.
 */
@Injectable()
export class EditTransactionUseCase {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactionRepository: TransactionRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository,
    @Inject(TRANSACTION_AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: TransactionAuditLogRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accountRepository: AccountRepository,
  ) {}

  async execute(input: EditTransactionInput): Promise<Transaction> {
    const existing = await this.transactionRepository.findById(input.transactionId);
    if (!existing) {
      throw new TransactionNotFoundError(input.transactionId);
    }
    if (existing.userId !== input.userId) {
      throw new UnauthorizedTransactionAccessError(input.transactionId, input.userId);
    }
    if (existing.isDeleted) {
      throw new TransactionAlreadyDeletedError(input.transactionId);
    }

    if (input.changes.currency !== undefined || input.changes.categoryId !== undefined) {
      await validateTransactionReferences(
        this.currencyRepository,
        this.categoryRepository,
        input.changes.currency ?? existing.currency,
        input.changes.categoryId ?? existing.categoryId,
      );
    }

    const now = new Date();
    let referenceLocalDate = now;
    if (input.changes.transactionDate !== undefined) {
      const user = await this.userRepository.findById(input.userId);
      if (!user) {
        throw new UserNotFoundError(input.userId);
      }
      referenceLocalDate = resolveUserLocalReferenceDate(now, user.timezone);
    }

    // Domain re-validates the merged result (amount/date/etc.) — throws
    // InvalidTransactionError on any invariant violation, including the two
    // pure-structural TRANSFER guards (goal-linked reject, independent
    // destinationAmount reject) documented on Transaction.edit() itself.
    const edited = existing.edit(input.changes, now, referenceLocalDate);

    // TASK-FIN-004 (FR-FIN-006) — the account-aware half of TRANSFER
    // cross-currency consistency: only runs when the edit actually touches
    // one of the three conversion-relevant fields, and only for TRANSFER
    // (every other type already rejected a non-null destinationAmount
    // above, inside existing.edit()). Compares the FINAL merged currency
    // against the destination account's REAL currency (never assumed) to
    // decide whether destinationAmount is required, forbidden, or must be
    // explicitly cleared — this is the one determination Transaction.edit()
    // itself cannot make, since it has no AccountRepository access.
    if (
      existing.transactionType === 'TRANSFER' &&
      (input.changes.amount !== undefined ||
        input.changes.currency !== undefined ||
        input.changes.destinationAmount !== undefined)
    ) {
      const destinationAccount = await this.accountRepository.findById(
        existing.destinationAccountId!,
      );
      if (!destinationAccount || destinationAccount.isDeleted) {
        throw new AccountNotFoundError(existing.destinationAccountId!);
      }
      // Re-checked here, not only at CreateTransferUseCase's own create-time
      // check: destinationAccountId is immutable post-creation, but the
      // ACCOUNT it points to is a live row this use case re-fetches on every
      // edit — same ownership check CreateTransferUseCase itself applies.
      if (destinationAccount.userId !== input.userId) {
        throw new UnauthorizedAccountAccessError(existing.destinationAccountId!, input.userId);
      }

      const isCrossCurrency = edited.currency !== destinationAccount.currency;
      const sourceSideChanged =
        input.changes.amount !== undefined || input.changes.currency !== undefined;

      if (isCrossCurrency) {
        if (
          (sourceSideChanged && input.changes.destinationAmount === undefined) ||
          edited.destinationAmount === null
        ) {
          throw new MissingDestinationAmountError(edited.currency, destinationAccount.currency);
        }
      } else if (edited.destinationAmount !== null) {
        throw new InvalidDestinationAmountEditError(
          'destinationAmount must be explicitly cleared (set to null) when this edit makes the TRANSFER same-currency; it must not be set at all for a transfer that is not cross-currency.',
        );
      }
    }

    const auditEntries = computeTransactionFieldDiffs(
      existing,
      edited,
      input.actor ?? 'user_edit',
      now,
    );

    const persisted = await this.transactionRepository.update(input.transactionId, input.changes);

    if (auditEntries.length > 0) {
      await this.auditLogRepository.record(auditEntries);
    }

    return persisted;
  }
}
