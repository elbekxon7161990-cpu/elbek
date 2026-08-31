import { Inject, Injectable } from '@nestjs/common';
import type {
  Transaction,
  TransactionAuditLogRepository,
  TransactionRepository,
} from '@afa/domain';
import { TRANSACTION_AUDIT_LOG_REPOSITORY, TRANSACTION_REPOSITORY } from '@afa/domain';

import type { DeleteTransactionInput } from '../dto/delete-transaction.input';
import { GoalLinkedTransferDeleteNotSupportedError } from '../errors/goal-linked-transfer-delete-not-supported.error';
import { TransactionAlreadyDeletedError } from '../errors/transaction-already-deleted.error';
import { TransactionNotFoundError } from '../errors/transaction-not-found.error';
import { UnauthorizedTransactionAccessError } from '../errors/unauthorized-transaction-access.error';

/**
 * FR-EXP-006 — soft-delete only, recoverable; never a hard delete from a
 * user-facing action. Chapter 8 §8.21.1's "full reconstructable audit trail
 * for financial mutations" covers this mutation too, so it's recorded to
 * `transaction_audit_log` as a `deleted_at` field change.
 *
 * TASK-FIN-004 (FR-FIN-006) — a TRANSFER that also contributes to a
 * SavingsGoal (goalId !== null) can never be deleted through this stage; see
 * `GoalLinkedTransferDeleteNotSupportedError`'s own doc comment. Deliberately
 * placed here at the application layer, not inside `Transaction.delete()`
 * itself — unlike the analogous edit-side guard, which lives in the domain
 * entity (see `Transaction.edit()`), keeping `delete()` a generic,
 * type-agnostic domain method.
 */
@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactionRepository: TransactionRepository,
    @Inject(TRANSACTION_AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: TransactionAuditLogRepository,
  ) {}

  async execute(input: DeleteTransactionInput): Promise<Transaction> {
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
    if (existing.transactionType === 'TRANSFER' && existing.goalId !== null) {
      throw new GoalLinkedTransferDeleteNotSupportedError(input.transactionId);
    }

    const now = new Date();
    // Sets the domain deletion state (also a defense-in-depth guard against
    // the already-deleted case checked above).
    existing.delete(now);

    // TASK-BOT-007-FIX — the `findById`/`isDeleted` check above is a
    // fast-path only (and still needed for NotFound/Unauthorized), never the
    // real concurrency guard: under genuine concurrency, two calls can both
    // read `isDeleted: false` before either write lands. The REAL guard is
    // `softDelete`'s own atomic conditional write — `null` means THIS call's
    // write did not land (someone else's did, whether racing right now or
    // earlier), so this call must not record a second audit entry for a
    // deletion it did not actually perform.
    const deleted = await this.transactionRepository.softDelete(input.transactionId);
    if (deleted === null) {
      throw new TransactionAlreadyDeletedError(input.transactionId);
    }

    await this.auditLogRepository.record([
      {
        transactionId: input.transactionId,
        fieldName: 'deleted_at',
        oldValue: null,
        newValue: now.toISOString(),
        changedBy: input.actor ?? 'user_edit',
        changedAt: now,
      },
    ]);

    return deleted;
  }
}
