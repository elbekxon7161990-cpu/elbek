import { randomUUID } from 'node:crypto';
import type { NewTransactionData } from '@afa/domain';
import { InvalidTransactionError } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaTransactionRepository } from './prisma-transaction.repository';

/**
 * TASK-REP-007-FIX (root cause discovered during TASK-REP-007) — the
 * required real-Postgres proof that `PrismaTransactionRepository.create()`
 * now validates the domain entity BEFORE any database write, closing the
 * orphaned-write bug: previously, a `create()` call rejected by domain
 * validation (e.g. a future-dated transaction) still left a fully-persisted
 * `transactions` row AND its paired `TransactionCommitted` `domain_events`
 * row behind, because `toDomainTransaction`'s re-validation ran only after
 * the write already committed.
 *
 * Owner-role connection (`DIRECT_URL ?? DATABASE_URL`), matching every
 * newer real-Postgres suite in this package (`transactional-outbox.
 * integration.spec.ts`, `prisma-domain-event.repository.dispatch.
 * integration.spec.ts`) — deliberately a NEW file, not an addition to the
 * pre-existing `prisma-transaction.repository.integration.spec.ts`, which
 * still uses the older, unrelated `DATABASE_URL`-only convention (a known,
 * separately-tracked, pre-existing environment gap — see TASK-DB-009/
 * FR-DB-015/TASK-REP-007's own final reports — not touched by this task).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TEST_TELEGRAM_USER_ID = 900_000_000_920n;
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
    description: 'create() atomicity check',
    originalText: 'create atomicity check',
    sourceType: 'manual',
    createdBy: 'user_manual',
    ...overrides,
  };
}

describe('PrismaTransactionRepository.create() — atomic validation (TASK-REP-007-FIX, real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const repository = new PrismaTransactionRepository(prisma, prisma);
  let userId: string;
  let categoryId: string;
  let currentTestTransactionIds: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();

    const user = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID, displayName: 'TASK-REP-007-FIX Test' },
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

  afterEach(async () => {
    if (currentTestTransactionIds.length > 0) {
      await prisma.domainEvent.deleteMany({
        where: { payload: { path: ['userId'], equals: userId } },
      });
      await prisma.transaction.deleteMany({ where: { id: { in: currentTestTransactionIds } } });
    }
    currentTestTransactionIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  async function countTransactionsFor(description: string): Promise<number> {
    return prisma.transaction.count({ where: { userId, description } });
  }

  async function countEventsFor(): Promise<number> {
    return prisma.domainEvent.count({
      where: { payload: { path: ['userId'], equals: userId }, eventType: 'TransactionCommitted' },
    });
  }

  it('A — a future-dated transaction is rejected, with ZERO rows persisted (the exact bug this task fixes)', async () => {
    const description = `future-date-reject-${randomUUID()}`;
    const eventsBefore = await countEventsFor();

    const futureDate = new Date();
    futureDate.setUTCDate(futureDate.getUTCDate() + 30); // safely, unambiguously in the future

    await expect(
      repository.create(
        baseTransactionData(categoryId, userId, { description, transactionDate: futureDate }),
      ),
    ).rejects.toThrow(InvalidTransactionError);
    await expect(
      repository.create(
        baseTransactionData(categoryId, userId, { description, transactionDate: futureDate }),
      ),
    ).rejects.toThrow('Transaction date cannot be in the future.');

    expect(await countTransactionsFor(description)).toBe(0);
    expect(await countEventsFor()).toBe(eventsBefore); // no new event either
  }, 30_000);

  it('B — a different domain invariant failure (invalid amount) is also rejected, with ZERO rows persisted', async () => {
    const description = `invalid-amount-reject-${randomUUID()}`;
    const eventsBefore = await countEventsFor();

    await expect(
      repository.create(baseTransactionData(categoryId, userId, { description, amount: '-500' })),
    ).rejects.toThrow(InvalidTransactionError);

    expect(await countTransactionsFor(description)).toBe(0);
    expect(await countEventsFor()).toBe(eventsBefore);
  }, 30_000);

  it('C — a valid transaction still persists both the transaction row and its TransactionCommitted event', async () => {
    const description = `valid-create-${randomUUID()}`;

    const created = await repository.create(
      baseTransactionData(categoryId, userId, { description }),
    );
    currentTestTransactionIds.push(created.id);

    const transactionRow = await prisma.transaction.findUnique({ where: { id: created.id } });
    expect(transactionRow).not.toBeNull();

    const events = await prisma.domainEvent.findMany({
      where: { payload: { path: ['transactionId'], equals: created.id } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('TransactionCommitted');
  }, 30_000);

  it('D — existing atomic-rollback behavior is intact: a DB-level failure (invalid category FK) after validation passes still rolls back both writes', async () => {
    const description = `db-level-rollback-${randomUUID()}`;
    const bogusCategoryId = randomUUID(); // syntactically valid UUID, no such category — passes domain validation (categoryId is just required to be non-empty), fails the real FK constraint
    const eventsBefore = await countEventsFor();

    await expect(
      repository.create(baseTransactionData(bogusCategoryId, userId, { description })),
    ).rejects.toThrow();

    expect(await countTransactionsFor(description)).toBe(0);
    expect(await countEventsFor()).toBe(eventsBefore);
  }, 30_000);

  it('E — RLS/user context handling is intact: create() still succeeds normally inside a real runWithUserContext scope', async () => {
    const description = `rls-context-preserved-${randomUUID()}`;

    const created = await runWithUserContext(userId, () =>
      repository.create(baseTransactionData(categoryId, userId, { description })),
    );
    currentTestTransactionIds.push(created.id);

    const transactionRow = await prisma.transaction.findUnique({ where: { id: created.id } });
    expect(transactionRow).not.toBeNull();
    expect(transactionRow?.userId).toBe(userId);
  }, 30_000);

  it('F — no duplicate event is created for a single successful create() call', async () => {
    const description = `no-duplicate-event-${randomUUID()}`;

    const created = await repository.create(
      baseTransactionData(categoryId, userId, { description }),
    );
    currentTestTransactionIds.push(created.id);

    const events = await prisma.domainEvent.findMany({
      where: { payload: { path: ['transactionId'], equals: created.id } },
    });
    expect(events).toHaveLength(1); // exactly one — not zero, not two
  }, 30_000);
});

describe('PrismaTransactionRepository.create() — atomic validation — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-REP-007-FIX environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});
