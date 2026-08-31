import { Inject, Injectable } from '@nestjs/common';
import type {
  Transaction,
  TransactionAuditLogRepository,
  TransactionRepository,
} from '@afa/domain';
import { TRANSACTION_AUDIT_LOG_REPOSITORY, TRANSACTION_REPOSITORY } from '@afa/domain';

import type { RestoreTransactionInput } from '../dto/restore-transaction.input';
import { TransactionNotDeletedError } from '../errors/transaction-not-deleted.error';
import { TransactionNotFoundError } from '../errors/transaction-not-found.error';
import { UnauthorizedTransactionAccessError } from '../errors/unauthorized-transaction-access.error';

/**
 * AC-EXP-003 — `/undo` restores a deleted transaction with all original
 * field values intact. `changedBy: 'undo'` is `transaction_audit_log`'s own
 * dedicated enum value (§13.9) for exactly this action.
 */
@Injectable()
export class RestoreTransactionUseCase {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactionRepository: TransactionRepository,
    @Inject(TRANSACTION_AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: TransactionAuditLogRepository,
  ) {}

  async execute(input: RestoreTransactionInput): Promise<Transaction> {
    const existing = await this.transactionRepository.findById(input.transactionId);
    if (!existing) {
      throw new TransactionNotFoundError(input.transactionId);
    }
    if (existing.userId !== input.userId) {
      throw new UnauthorizedTransactionAccessError(input.transactionId, input.userId);
    }
    if (!existing.isDeleted) {
      throw new TransactionNotDeletedError(input.transactionId);
    }

    const now = new Date();
    const deletedAtBeforeRestore = existing.deletedAt;
    // Sets the domain active state (also a defense-in-depth guard against
    // the not-deleted case checked above).
    existing.restore(now);

    // TASK-FIN-013 — the `findById`/`isDeleted` check above is a fast-path
    // only, never the real concurrency guard: under genuine concurrency, two
    // `/undo` calls can both read `isDeleted: true` before either write
    // lands. The REAL guard is `restore`'s own atomic conditional write —
    // `null` means THIS call's write did not land (someone else's did,
    // whether racing right now or an earlier already-completed restore), so
    // this call must not record a second "restored" audit entry for a
    // restoration it did not actually perform (mirrors
    // `DeleteTransactionUseCase`'s identical `softDelete`-race handling).
    const restored = await this.transactionRepository.restore(input.transactionId);
    if (restored === null) {
      throw new TransactionNotDeletedError(input.transactionId);
    }

    await this.auditLogRepository.record([
      {
        transactionId: input.transactionId,
        fieldName: 'deleted_at',
        oldValue: deletedAtBeforeRestore ? deletedAtBeforeRestore.toISOString() : null,
        newValue: null,
        changedBy: 'undo',
        changedAt: now,
      },
    ]);

    return restored;
  }
}
