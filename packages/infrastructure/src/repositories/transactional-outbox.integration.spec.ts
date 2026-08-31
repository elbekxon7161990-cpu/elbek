import { randomUUID } from 'node:crypto';
import type { NewTransactionData } from '@afa/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaTransactionRepository } from './prisma-transaction.repository';

/**
 * TASK-DB-010 (FR-DB-014, Chapter 13 §13.30) — the required real-Postgres
 * proof that a `transactions` row and its paired `domain_events`
 * (`TransactionCommitted`) row are written atomically: both commit, or
 * neither does. This is the DoD itself ("An event is never observably
 * emitted for a transaction that was subsequently rolled back"), not a
 * secondary concern.
 *
 * Owner-role connection (`DIRECT_URL`, matching `prisma-draft.repository.
 * integration.spec.ts`'s own established precedent) — this suite validates
 * atomicity/CRUD correctness, not RLS enforcement itself (that remains
 * `rls-user-context.integration.spec.ts`'s dedicated job); `create()`'s
 * manual `set_config` step is a no-op against the owner role either way
 * (Postgres never enforces row-level security against a table's owner), so
 * this suite exercises the exact same atomic-transaction code path
 * production traffic does, just without a user context established.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TEST_TELEGRAM_USER_ID = 900_000_000_901n;
const CURRENCY_CODE = 'UZS';

function baseTransactionData(
  categoryId: string,
  userId: string,
  overrides: Partial<NewTransactionData> = {},
): NewTransactionData {
  return {
    userId,
    transactionType: 'EXPENSE',
    amount: '12000',
    currency: CURRENCY_CODE,
    categoryId,
    transactionDate: new Date('2026-01-15'),
    description: 'Outbox atomicity check',
    originalText: 'outbox atomicity check',
    sourceType: 'manual',
    createdBy: 'user_manual',
    ...overrides,
  };
}

describe('Transactional-Outbox Event Storage (TASK-DB-010, FR-DB-014, real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const repository = new PrismaTransactionRepository(prisma, prisma);
  let userId: string;
  let categoryId: string;
  const createdTransactionIds: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();

    const user = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID, displayName: 'TASK-DB-010 Outbox Test' },
      update: {},
    });
    userId = user.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active' },
    });
    if (!category) {
      throw new Error('No active expense category found — run `prisma db seed` before this suite.');
    }
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.domainEvent.deleteMany({
      where: { payload: { path: ['userId'], equals: userId } },
    });
    await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  describe('Scenario A — successful create: both rows exist, atomically paired', () => {
    it('creates exactly one TransactionCommitted domain event alongside the transaction, with the correct type/payload/status', async () => {
      const created = await repository.create(baseTransactionData(categoryId, userId));
      createdTransactionIds.push(created.id);

      // --- the transaction itself exists ---
      const transactionRow = await prisma.transaction.findUnique({ where: { id: created.id } });
      expect(transactionRow).not.toBeNull();

      // --- exactly one corresponding domain event exists ---
      const events = await prisma.domainEvent.findMany({
        where: { payload: { path: ['transactionId'], equals: created.id } },
      });
      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.eventType).toBe('TransactionCommitted');
      expect(event.status).toBe('pending');
      // TASK-DB-009 (FR-DB-025) — `transactionDate` was added to
      // `TransactionCommittedPayload` after TASK-DB-010 shipped this
      // assertion; cache invalidation cannot determine which
      // `report:{...}:{period_key}` keys are affected without it. See
      // `TransactionCommittedPayload`'s own doc comment (`@afa/domain`).
      expect(event.payload).toEqual({
        transactionId: created.id,
        userId,
        transactionDate: '2026-01-15T00:00:00.000Z',
      });
      expect(event.dispatchAttempts).toBe(0);
      expect(event.dispatchedAt).toBeNull();
    });
  });

  describe('Scenario B — forced rollback: no observable event for a transaction that never committed', () => {
    it('B1 (the real create() path): an invalid category FK fails the transaction write itself — neither row exists afterward', async () => {
      const bogusCategoryId = randomUUID(); // syntactically valid UUID, no such category row

      await expect(
        repository.create(
          baseTransactionData(bogusCategoryId, userId, { description: 'Should never persist' }),
        ),
      ).rejects.toThrow();

      const orphanedEvents = await prisma.domainEvent.findMany({
        where: { payload: { path: ['userId'], equals: userId }, eventType: 'TransactionCommitted' },
      });
      // Only Scenario A's single, already-asserted event may exist for this
      // user at this point in the suite — this failed attempt must add none.
      expect(orphanedEvents).toHaveLength(1);

      const strayTransactions = await prisma.transaction.findMany({
        where: { userId, description: 'Should never persist' },
      });
      expect(strayTransactions).toHaveLength(0);
    });

    it('B2 (mechanism-level proof): a THIRD statement failing AFTER both the transaction and event writes already succeeded still rolls back all of it — this is the literal "both commit or both roll back" guarantee FR-DB-014 requires, not merely "the first statement never got far enough to write anything"', async () => {
      const doomedId = randomUUID();
      const rawTransactionData = {
        id: doomedId,
        userId,
        transactionType: 'EXPENSE',
        amount: '12000',
        currency: CURRENCY_CODE,
        categoryId,
        transactionDate: new Date('2026-01-15'),
        description: 'Doomed by a later statement',
        originalText: 'outbox atomicity check',
        sourceType: 'manual',
        createdBy: 'user_manual',
      };

      await expect(
        prisma.$transaction(async (tx) => {
          const transactionRow = await tx.transaction.create({ data: rawTransactionData });
          await tx.domainEvent.create({
            data: {
              eventType: 'TransactionCommitted',
              payload: { transactionId: transactionRow.id, userId },
              status: 'pending',
            },
          });
          // Deliberate, forced failure — a duplicate-PK insert against the
          // very row this same transaction just created (unique-violation,
          // Postgres error 23505) — happening strictly AFTER both prior
          // writes have already (locally, pre-commit) succeeded.
          await tx.transaction.create({ data: rawTransactionData });
        }),
      ).rejects.toThrow();

      const doomedTransaction = await prisma.transaction.findUnique({ where: { id: doomedId } });
      expect(doomedTransaction).toBeNull();

      const doomedEvents = await prisma.domainEvent.findMany({
        where: { payload: { path: ['transactionId'], equals: doomedId } },
      });
      expect(doomedEvents).toHaveLength(0);
    });
  });

  describe('Scenario C — idempotency/uniqueness: reported limitation, not invented', () => {
    it('the schema defines no uniqueness constraint on domain_events — two create() calls for the same logical transaction-commit context each produce their own distinct event row, with no storage-layer dedup', async () => {
      // §13.30.2's own column list is id/event_type/payload/status/
      // dispatch_attempts/created_at/dispatched_at with a single
      // `@@index([status, createdAt])` — no `@@unique` anywhere. Confirmed
      // directly against schema.prisma before writing this test, per this
      // task's explicit "do not invent a schema constraint" instruction.
      const first = await repository.create(
        baseTransactionData(categoryId, userId, { description: 'Dedup check A' }),
      );
      const second = await repository.create(
        baseTransactionData(categoryId, userId, { description: 'Dedup check B' }),
      );
      createdTransactionIds.push(first.id, second.id);

      const firstEvents = await prisma.domainEvent.findMany({
        where: { payload: { path: ['transactionId'], equals: first.id } },
      });
      const secondEvents = await prisma.domainEvent.findMany({
        where: { payload: { path: ['transactionId'], equals: second.id } },
      });

      // Each real, distinct commit gets exactly its own event — this is
      // FR-FIN-048's "emitted exactly once per triggering transition"
      // satisfied structurally by this task's atomic single-call design,
      // not by a schema-level uniqueness guard. What this test does NOT
      // (and structurally cannot) prove: that calling create() twice for
      // what a caller considers "the same" business event would be
      // deduplicated — nothing in the current schema/PRD specifies that,
      // and idempotent *consumption* (as opposed to storage-level dedup)
      // is FR-FIN-048's other half, explicitly deferred to FR-DB-015's
      // not-yet-built dispatch worker. Reported as a real, bounded
      // limitation, not silently assumed away.
      expect(firstEvents).toHaveLength(1);
      expect(secondEvents).toHaveLength(1);
      expect(firstEvents[0]!.id).not.toBe(secondEvents[0]!.id);
    });
  });
});
