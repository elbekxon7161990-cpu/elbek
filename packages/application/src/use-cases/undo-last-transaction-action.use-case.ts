import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_REPOSITORY, type Transaction, type TransactionRepository } from '@afa/domain';

import { DeleteTransactionUseCase } from './delete-transaction.use-case';
import { RestoreTransactionUseCase } from './restore-transaction.use-case';

export type UndoLastTransactionActionOutcome =
  | { readonly kind: 'nothing_to_undo' }
  | { readonly kind: 'unsupported_action' }
  | { readonly kind: 'undone'; readonly action: 'created' | 'deleted'; readonly transaction: Transaction };

/**
 * TASK-FIN-013 (Chapter 10 §10.4, FR-UND-001/002) — resolves the per-user
 * "last action" pointer (FR-UND-001: the most recently touched transaction,
 * `TransactionRepository.findMostRecentByUserId`) and reverses it by
 * delegating to the ALREADY-EXISTING, unmodified `DeleteTransactionUseCase`/
 * `RestoreTransactionUseCase` — this use case adds no new mutation logic of
 * its own, only the "which one to call" orchestration those two use cases
 * never needed before `/undo` existed.
 *
 * Scope (see this task's own final report for the full reasoning): only
 * "last action = delete" (→ restore) and "last action = create, never since
 * edited" (→ delete) are reversed. "Last action = edit" has no real backend
 * anywhere in this codebase — `TransactionAuditLogRepository` is
 * write-only, nothing can read back a prior field value to revert to —
 * building that is real new scope, not Telegram wiring, so this
 * deliberately reports `'unsupported_action'` rather than either (a)
 * guessing at a revert that doesn't exist, or (b) soft-deleting a
 * transaction that was merely edited (which would be a genuine, silent
 * data-loss bug: deleting a legitimately-edited record because it happens
 * to also be the most recently touched one).
 *
 * FR-UND-002's "idempotent-safe against double-invocation... acts on the
 * new most-recent action" is satisfied structurally: every call re-resolves
 * `findMostRecentByUserId` fresh, never reusing a previously-resolved
 * pointer — calling this twice in a row naturally undoes the undo itself
 * (the just-restored/just-deleted transaction is now the new "most
 * recent"), matching the PRD's own "undo the undo" edge case (§10.4.8)
 * without any special-case code.
 */
@Injectable()
export class UndoLastTransactionActionUseCase {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactionRepository: TransactionRepository,
    private readonly deleteTransaction: DeleteTransactionUseCase,
    private readonly restoreTransaction: RestoreTransactionUseCase,
  ) {}

  async execute(userId: string): Promise<UndoLastTransactionActionOutcome> {
    const last = await this.transactionRepository.findMostRecentByUserId(userId);
    if (!last) {
      return { kind: 'nothing_to_undo' };
    }

    if (last.isDeleted) {
      const transaction = await this.restoreTransaction.execute({ transactionId: last.id, userId });
      return { kind: 'undone', action: 'deleted', transaction };
    }

    // `createdAt === updatedAt` means this transaction has never been
    // edited since its own creation — the last (and only) thing ever done
    // to it WAS its creation, so undoing it means deleting it. Any other
    // not-yet-deleted transaction has been edited at least once since
    // creation, meaning the true last action was an edit — unsupported (see
    // this class's own doc comment above).
    if (last.createdAt.getTime() === last.updatedAt.getTime()) {
      const transaction = await this.deleteTransaction.execute({
        transactionId: last.id,
        userId,
        actor: 'undo',
      });
      return { kind: 'undone', action: 'created', transaction };
    }

    return { kind: 'unsupported_action' };
  }
}
