import { Injectable } from '@nestjs/common';
import type {
  DomainEventDispatchDecision,
  DomainEventDispatchResult,
  DomainEventRecord,
  DomainEventRepository,
  DomainEventStatus,
  DomainEventType,
  NewDomainEventData,
} from '@afa/domain';
import type { DomainEvent as PrismaDomainEvent, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

function toDomainEventRecord(row: PrismaDomainEvent): DomainEventRecord {
  return {
    id: row.id,
    eventType: row.eventType as DomainEventType,
    payload: row.payload as Record<string, unknown>,
    status: row.status as DomainEventStatus,
    dispatchAttempts: row.dispatchAttempts,
    createdAt: row.createdAt,
    dispatchedAt: row.dispatchedAt,
  };
}

/**
 * The shape `$queryRaw` returns for the claim query below — columns are
 * explicitly aliased to these exact camelCase names in the SQL itself (raw
 * queries bypass Prisma's own model-field mapping), so this is a plain,
 * already-correctly-shaped row, not a second mapping layer to maintain.
 */
interface ClaimedDomainEventRow {
  id: string;
  eventType: string;
  payload: unknown;
  status: string;
  dispatchAttempts: number;
  createdAt: Date;
  dispatchedAt: Date | null;
}

/**
 * TASK-DB-010 — implements @afa/domain's `DomainEventRepository` port
 * against `domain_events` (§13.30.2). A standalone, non-transactionally-
 * coupled write — see the port's own doc comment for why
 * `PrismaTransactionRepository.create()`'s atomic `TransactionCommitted`
 * coupling (FR-DB-014) deliberately does NOT go through this class, using a
 * direct, hand-rolled Prisma `$transaction` instead. This repository is the
 * standalone capability: useful on its own merits (a producer that doesn't
 * need same-transaction atomicity with anything else), and the foundation a
 * future dispatch worker (FR-DB-015, out of this task's scope) would extend
 * with read/claim/mark-dispatched methods.
 *
 * `DomainEvent` is deliberately NOT in `RLS_PROTECTED_MODELS`
 * (`rls-protected-models.ts`) — it is a system-wide dispatch queue, not
 * directly user-queried data, the same treatment already given to
 * `TransactionAuditLog`/`Category`.
 */
@Injectable()
export class PrismaDomainEventRepository implements DomainEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(data: NewDomainEventData): Promise<DomainEventRecord> {
    const row = await this.prisma.domainEvent.create({
      data: {
        eventType: data.eventType,
        payload: data.payload as unknown as Prisma.InputJsonValue,
        status: 'pending' satisfies DomainEventStatus,
      },
    });
    return toDomainEventRecord(row);
  }

  /**
   * FR-DB-015 — see the port's own doc comment (`@afa/domain`) for why this
   * is one method, not three. `this.prisma` (the RLS-extended client) is
   * used deliberately, unlike `PrismaTransactionRepository.create()`'s
   * `PRISMA_BASE_CLIENT` — `DomainEvent` is NOT in `RLS_PROTECTED_MODELS`
   * (this class's own doc comment above), so the RLS extension passes every
   * operation against it straight through unmodified; `$transaction`/
   * `$queryRaw` are themselves client-level methods the extension never
   * intercepts at all (`rls-context.extension.ts`'s own doc comment), so
   * there is no RLS-extension conflict here to work around in the first
   * place — TASK-DB-010's own resolution simply does not apply to this
   * table, and is not reopened or redesigned by this method.
   *
   * `FOR UPDATE SKIP LOCKED` is why two concurrent callers of this method
   * can never claim the same row: the second caller's `SELECT` skips any
   * row already locked by the first caller's still-open transaction,
   * finding the next-oldest pending row (or none) instead. If this
   * transaction is rolled back or the process crashes before `COMMIT`,
   * Postgres releases the row lock automatically and the row is left
   * exactly as it was — still `status = 'pending'`, safely re-claimable by
   * the next poll (§13.30.4's crash-safety guarantee, satisfied structurally
   * by ordinary transaction semantics, with no extra bookkeeping of this
   * method's own).
   */
  async dispatchNextPending(
    handler: (event: DomainEventRecord) => Promise<DomainEventDispatchDecision>,
  ): Promise<DomainEventDispatchResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const claimedRows = await tx.$queryRaw<ClaimedDomainEventRow[]>`
        SELECT id, event_type AS "eventType", payload, status,
               dispatch_attempts AS "dispatchAttempts", created_at AS "createdAt",
               dispatched_at AS "dispatchedAt"
        FROM domain_events
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      const claimedRow = claimedRows[0];
      if (!claimedRow) {
        return null;
      }

      const claimed: DomainEventRecord = {
        id: claimedRow.id,
        eventType: claimedRow.eventType as DomainEventType,
        payload: claimedRow.payload as Record<string, unknown>,
        status: claimedRow.status as DomainEventStatus,
        dispatchAttempts: claimedRow.dispatchAttempts,
        createdAt: claimedRow.createdAt,
        dispatchedAt: claimedRow.dispatchedAt,
      };

      const decision = await handler(claimed);

      if (decision.outcome === 'dispatched') {
        await tx.domainEvent.update({
          where: { id: claimed.id },
          data: { status: 'dispatched' satisfies DomainEventStatus, dispatchedAt: new Date() },
        });
      } else if (decision.outcome === 'retry') {
        await tx.domainEvent.update({
          where: { id: claimed.id },
          data: { dispatchAttempts: { increment: 1 } },
        });
      } else {
        await tx.domainEvent.update({
          where: { id: claimed.id },
          data: decision.incrementAttempts
            ? {
                status: 'failed' satisfies DomainEventStatus,
                dispatchAttempts: { increment: 1 },
              }
            : { status: 'failed' satisfies DomainEventStatus },
        });
      }

      return { event: claimed, decision };
    });
  }
}
