import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountPurgeCandidate,
  AccountPurgeCounts,
  AccountPurgeOutcome,
  AccountPurgeRepository,
  ObjectStoragePort,
} from '@afa/domain';
import { OBJECT_STORAGE, ObjectStorageError } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-AUTH-006 (FR-RET-002 — hard purge "across PostgreSQL and Object
 * Storage"). Implements the verified, real FK dependency order derived
 * directly from `20260808000000_init/migration.sql` (every `RESTRICT` FK
 * touching a user-owned table was individually re-read before this order
 * was written — not guessed from the PRD's prose alone):
 *
 *   1. debt_repayments        (debt_id IN this user's own debt ids)
 *   2. budget_notification_log (budget_id IN this user's own budget ids)
 *   3. loan_payments          (loan_id IN this user's own loan ids)
 *   4. transaction_audit_log  (transaction_id IN this user's own transaction
 *                              ids — NOT RLS-protected, so this explicit
 *                              filter is the ONLY safety mechanism here)
 *   5. transaction_drafts     (must precede transactions: resolved_transaction_id FK)
 *   6. scheduled_transactions (must precede transactions: resolved_transaction_id FK)
 *   7. transactions           (must precede accounts/savings_goals/debts'
 *                              own dependents; self-referencing
 *                              linked_transaction_id is safe under one
 *                              deleteMany — standard Postgres statement-
 *                              level RESTRICT checking)
 *   8. debts                  (must precede counterparties: counterparty_ref_id FK)
 *   9. budgets
 *  10. loans
 *  11. accounts
 *  12. savings_goals
 *  13. counterparties
 *  14. recurring_templates
 *  15. notifications
 *  16. user_settings
 *  17. user_financial_summary
 *  18. categories WHERE owner_user_id = this user (custom categories only —
 *      NOT RLS-protected, explicit filter is the only safety mechanism)
 *  19. Object Storage cleanup (see ObjectStoragePort.deleteObjectsByPrefix's
 *      own doc comment for why this is prefix-based, not a DB-tracked list)
 *  20. audit_log INSERT — one system action (actor_type='system',
 *      target_user_id=this user, action='account_purge')
 *  21. users DELETE — hard delete, the true point of no return
 *
 * NOT one Postgres transaction. `rls-context.extension.ts`'s own contract
 * (see its doc comment) wraps EVERY RLS-protected-model call in its own
 * independent 2-statement `set_config` + query transaction on the *base*
 * client — nesting several such calls inside one outer interactive
 * `$transaction` is not something this extension supports (the base
 * client's own `$transaction` would be invoked from inside an
 * already-open transaction on a different client instance). Given that
 * real, structural constraint, cross-table atomicity is achieved
 * differently: every step here is independently idempotent (re-running a
 * `deleteMany` against an already-empty table is a no-op), so a crash or a
 * storage failure partway through never corrupts state — it just leaves
 * the `users` row exactly as it was (`status='pending_deletion'`), and the
 * next scheduled scan safely resumes/redoes the sweep to completion. The
 * two genuinely irreversible steps (the audit-log insert and the `users`
 * hard delete) are deliberately LAST, after every other step has
 * succeeded, so a failure never reaches them.
 *
 * Runs entirely inside one `runWithUserContext(candidate.id, ...)` call:
 * every RLS-protected read/delete above is correctly scoped by Postgres's
 * own row-level security as a first layer, AND by an explicit `userId`/
 * FK-chain-derived `where` filter as the real, primary safety mechanism
 * this task's own requirements call for — RLS is defense-in-depth here,
 * never the only thing standing between one user's purge and another
 * user's data.
 */
@Injectable()
export class PrismaAccountPurgeRepository implements AccountPurgeRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStoragePort,
  ) {}

  async purgeUser(candidate: AccountPurgeCandidate, _now: Date): Promise<AccountPurgeOutcome> {
    const userId = candidate.id;

    const counts = await runWithUserContext(userId, async (): Promise<AccountPurgeCounts> => {
      const debtIds = (
        await this.prisma.debt.findMany({ where: { userId }, select: { id: true } })
      ).map((d) => d.id);
      const debtRepayments = await this.prisma.debtRepayment.deleteMany({
        where: { debtId: { in: debtIds } },
      });

      const budgetIds = (
        await this.prisma.budget.findMany({ where: { userId }, select: { id: true } })
      ).map((b) => b.id);
      const budgetNotificationLog = await this.prisma.budgetNotificationLog.deleteMany({
        where: { budgetId: { in: budgetIds } },
      });

      const loanIds = (
        await this.prisma.loan.findMany({ where: { userId }, select: { id: true } })
      ).map((l) => l.id);
      const loanPayments = await this.prisma.loanPayment.deleteMany({
        where: { loanId: { in: loanIds } },
      });

      const transactionIds = (
        await this.prisma.transaction.findMany({ where: { userId }, select: { id: true } })
      ).map((t) => t.id);
      const transactionAuditLog = await this.prisma.transactionAuditLog.deleteMany({
        where: { transactionId: { in: transactionIds } },
      });

      const transactionDrafts = await this.prisma.transactionDraft.deleteMany({
        where: { userId },
      });
      const scheduledTransactions = await this.prisma.scheduledTransaction.deleteMany({
        where: { userId },
      });
      const transactions = await this.prisma.transaction.deleteMany({ where: { userId } });

      const debts = await this.prisma.debt.deleteMany({ where: { userId } });
      const budgets = await this.prisma.budget.deleteMany({ where: { userId } });
      const loans = await this.prisma.loan.deleteMany({ where: { userId } });
      const accounts = await this.prisma.account.deleteMany({ where: { userId } });
      const savingsGoals = await this.prisma.savingsGoal.deleteMany({ where: { userId } });
      const counterparties = await this.prisma.counterparty.deleteMany({ where: { userId } });
      const recurringTemplates = await this.prisma.recurringTemplate.deleteMany({
        where: { userId },
      });
      const notifications = await this.prisma.notification.deleteMany({ where: { userId } });
      const userSettings = await this.prisma.userSetting.deleteMany({ where: { userId } });
      const userFinancialSummary = await this.prisma.userFinancialSummary.deleteMany({
        where: { userId },
      });
      const customCategories = await this.prisma.category.deleteMany({
        where: { ownerUserId: userId },
      });

      return {
        debtRepayments: debtRepayments.count,
        budgetNotificationLog: budgetNotificationLog.count,
        loanPayments: loanPayments.count,
        transactionAuditLog: transactionAuditLog.count,
        transactionDrafts: transactionDrafts.count,
        scheduledTransactions: scheduledTransactions.count,
        transactions: transactions.count,
        debts: debts.count,
        budgets: budgets.count,
        loans: loans.count,
        accounts: accounts.count,
        savingsGoals: savingsGoals.count,
        counterparties: counterparties.count,
        recurringTemplates: recurringTemplates.count,
        notifications: notifications.count,
        userSettings: userSettings.count,
        userFinancialSummary: userFinancialSummary.count,
        customCategories: customCategories.count,
      };
    });

    try {
      await this.objectStorage.deleteObjectsByPrefix(`voice/${userId}/`);
      await this.objectStorage.deleteObjectsByPrefix(`photo/${userId}/`);
    } catch (error) {
      if (error instanceof ObjectStorageError) {
        return { kind: 'storage_failure', candidate };
      }
      throw error;
    }

    await this.prisma.auditLog.create({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'account_purge',
        targetUserId: userId,
        targetResource: 'users',
        justification: 'FR-RET-002 — 30-day grace period elapsed, scheduled purge executed.',
        metadata: { ...counts } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.prisma.user.delete({ where: { id: userId } });

    return { kind: 'purged', candidate, counts };
  }
}
