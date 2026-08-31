import { Injectable } from '@nestjs/common';
import type {
  DraftRepository,
  DraftStatus,
  DraftStatusPatch,
  NewTransactionDraftData,
  TransactionDraftRecord,
  TransactionExtractionCandidate,
  TransactionSourceType,
} from '@afa/domain';
import type { Prisma, TransactionDraft as PrismaTransactionDraft } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

function toDomainDraft(row: PrismaTransactionDraft): TransactionDraftRecord {
  return {
    id: row.id,
    userId: row.userId,
    partialData: row.partialData as unknown as TransactionExtractionCandidate,
    missingFields: row.missingFields,
    status: row.status as DraftStatus,
    originalText: row.originalText,
    sourceType: row.sourceType as TransactionSourceType,
    resolvedTransactionId: row.resolvedTransactionId,
    createdAt: row.createdAt,
    lastInteractionAt: row.lastInteractionAt,
    deletedAt: row.deletedAt,
  };
}

/**
 * TASK-BOT-004 — implements @afa/domain's `DraftRepository` port against
 * `transaction_drafts` (§13.5). `TransactionDraft` is already in
 * `RLS_PROTECTED_MODELS`, so every call below is automatically wrapped by
 * `rls-context.extension.ts` with `set_config('app.current_user_id', ...)`
 * from the current AsyncLocalStorage user context — the explicit `userId`
 * filter in `findActiveByUserId` is defense-in-depth query-intent
 * correctness on top of that, not the only isolation mechanism (same
 * pattern as `PrismaTransactionRepository.findByUserId`).
 */
@Injectable()
export class PrismaDraftRepository implements DraftRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewTransactionDraftData): Promise<TransactionDraftRecord> {
    const row = await this.prisma.transactionDraft.create({
      data: {
        id: data.id,
        userId: data.userId,
        // Prisma's `Json` input type needs the candidate serialized through
        // a JSON-safe object — `TransactionExtractionCandidate` is already
        // plain data (no class instances/functions), so a structured clone
        // via JSON round-trip is unnecessary; Prisma accepts it directly.
        partialData: data.partialData as unknown as Prisma.InputJsonValue,
        missingFields: [...data.missingFields],
        status: 'pending' satisfies DraftStatus,
        originalText: data.originalText,
        sourceType: data.sourceType,
      },
    });
    return toDomainDraft(row);
  }

  async findById(id: string): Promise<TransactionDraftRecord | null> {
    const row = await this.prisma.transactionDraft.findUnique({ where: { id } });
    return row ? toDomainDraft(row) : null;
  }

  async findActiveByUserId(userId: string): Promise<TransactionDraftRecord[]> {
    const rows = await this.prisma.transactionDraft.findMany({
      where: { userId, status: 'pending' satisfies DraftStatus, deletedAt: null },
      orderBy: { lastInteractionAt: 'desc' },
    });
    return rows.map(toDomainDraft);
  }

  async updateStatus(id: string, patch: DraftStatusPatch): Promise<TransactionDraftRecord> {
    // transaction_drafts.resolved_transaction_id targets the partitioned
    // transactions table's composite (id, transaction_date) key, not id
    // alone (schema.prisma's TransactionDraft model comment) — same pattern
    // as PrismaTransactionRepository.resolveTransactionDate /
    // PrismaTransactionAuditLogRepository.record.
    const resolvedTransactionDate = patch.resolvedTransactionId
      ? await this.resolveTransactionDate(patch.resolvedTransactionId)
      : undefined;

    const row = await this.prisma.transactionDraft.update({
      where: { id },
      data: {
        status: patch.status,
        ...(patch.resolvedTransactionId !== undefined && {
          resolvedTransactionId: patch.resolvedTransactionId,
          resolvedTransactionDate,
        }),
        lastInteractionAt: new Date(),
      },
    });
    return toDomainDraft(row);
  }

  private async resolveTransactionDate(transactionId: string): Promise<Date> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { transactionDate: true },
    });
    if (!transaction) {
      throw new Error(`Cannot resolve draft to transaction "${transactionId}": it does not exist.`);
    }
    return transaction.transactionDate;
  }
}
