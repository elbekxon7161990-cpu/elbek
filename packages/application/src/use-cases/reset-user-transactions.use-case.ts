import { Inject, Injectable } from '@nestjs/common';
import type {
  AuditLogRepository,
  TransactionAuditLogRepository,
  TransactionRepository,
} from '@afa/domain';
import {
  AUDIT_LOG_REPOSITORY,
  TRANSACTION_AUDIT_LOG_REPOSITORY,
  TRANSACTION_REPOSITORY,
} from '@afa/domain';

export interface ResetUserTransactionsResult {
  deletedCount: number;
}

/**
 * Web admin panel — an explicit, informed-consent action distinct from
 * `DeleteTransactionUseCase`: it deliberately bypasses that use case's own
 * `GoalLinkedTransferDeleteNotSupportedError` guard (soft-deleting a
 * goal-linked TRANSFER through `TransactionRepository.softDelete()`
 * directly, never through `DeleteTransactionUseCase`) because a bulk
 * "reset this user's entire transaction history" admin action is a
 * fundamentally different operation from a single user-facing delete — the
 * guard exists to protect an individual user's own delete action from
 * silently corrupting their own savings-goal progress, not to block an
 * admin's own deliberate, justified bulk reset. Known, accepted
 * consequence (confirmed with the product owner before building this):
 * any `SavingsGoal.currentAmount` fed by a goal-linked TRANSFER deleted
 * here is left stale — no reconciliation mechanism exists yet.
 *
 * Still soft-delete only (`FR-EXP-006`'s "never a hard delete" discipline
 * applies here too), never touching accounts/debts/budgets/goals
 * themselves — only `transactions` rows, per its own name.
 *
 * Writes two kinds of audit trail: a per-transaction
 * `transaction_audit_log` entry (`changedBy: 'api'` — the closest existing
 * value for "an external/administrative actor, not the end user
 * themselves"; the enum has no dedicated `'admin'` value and adding one is
 * a schema change out of this task's scope) for FR-EXP-007's own
 * discipline, AND one summary entry via the generic `AuditLogRepository`
 * (`action: 'user.reset_transactions'`) for the admin-action trail,
 * mirroring `BlockUserUseCase`'s own audit pattern.
 */
@Injectable()
export class ResetUserTransactionsUseCase {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly transactionRepository: TransactionRepository,
    @Inject(TRANSACTION_AUDIT_LOG_REPOSITORY)
    private readonly transactionAuditLogRepository: TransactionAuditLogRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async execute(
    userId: string,
    justification: string,
    actorAdminId: string,
  ): Promise<ResetUserTransactionsResult> {
    const active = await this.transactionRepository.findByUserId(userId);
    const now = new Date();

    const deletedIds: string[] = [];
    for (const transaction of active) {
      const deleted = await this.transactionRepository.softDelete(transaction.id);
      if (deleted) {
        deletedIds.push(transaction.id);
      }
    }

    if (deletedIds.length > 0) {
      await this.transactionAuditLogRepository.record(
        deletedIds.map((transactionId) => ({
          transactionId,
          fieldName: 'deleted_at',
          oldValue: null,
          newValue: now.toISOString(),
          changedBy: 'api' as const,
          changedAt: now,
        })),
      );
    }

    await this.auditLogRepository.create({
      actorType: 'admin',
      actorId: actorAdminId,
      action: 'user.reset_transactions',
      targetUserId: userId,
      targetResource: null,
      justification,
      ipAddress: null,
      metadata: { deletedCount: deletedIds.length },
    });

    return { deletedCount: deletedIds.length };
  }
}
