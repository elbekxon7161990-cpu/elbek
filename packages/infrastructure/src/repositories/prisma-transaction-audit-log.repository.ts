import { Injectable } from '@nestjs/common';
import type { TransactionAuditLogEntry, TransactionAuditLogRepository } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-001 Part 3 — appends to the existing `transaction_audit_log`
 * table (§13.9, partitioned quarterly per §13.12; no new schema). Immutable
 * per Chapter 16 §16.4.2 — this repository only ever inserts, never
 * updates/deletes, and the `app_user`/`app_admin` database roles have
 * UPDATE/DELETE revoked on this table at the grant level (migration.sql) as
 * a second, database-enforced line of defense.
 */
@Injectable()
export class PrismaTransactionAuditLogRepository implements TransactionAuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(entries: TransactionAuditLogEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    // transaction_audit_log's FK targets the partitioned transactions
    // table's composite (id, transaction_date) key, not id alone — every
    // entry's transactionDate has to be resolved first (same pattern as
    // PrismaTransactionRepository.resolveTransactionDate).
    const uniqueTransactionIds = [...new Set(entries.map((entry) => entry.transactionId))];
    const transactions = await this.prisma.transaction.findMany({
      where: { id: { in: uniqueTransactionIds } },
      select: { id: true, transactionDate: true },
    });
    const transactionDateById = new Map(
      transactions.map((transaction) => [transaction.id, transaction.transactionDate]),
    );

    await this.prisma.transactionAuditLog.createMany({
      data: entries.map((entry) => {
        const transactionDate = transactionDateById.get(entry.transactionId);
        if (!transactionDate) {
          throw new Error(
            `Cannot record audit entry: transaction "${entry.transactionId}" not found.`,
          );
        }
        return {
          transactionId: entry.transactionId,
          transactionDate,
          fieldName: entry.fieldName,
          // Preserved exactly as given, including null — no `?? ''` or
          // similar defaulting that would lose the "no prior value"/
          // "cleared to nothing" distinction.
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          changedBy: entry.changedBy,
          changedAt: entry.changedAt,
        };
      }),
    });
  }
}
