import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaDomainEventRepository } from './prisma-domain-event.repository';

/**
 * TASK-DB-010 — the standalone `DomainEventRepository` adapter, tested on
 * its own merits (a plain, non-transactionally-coupled insert). This is
 * NOT the FR-DB-014 atomicity proof — see `transactional-outbox.integration.
 * spec.ts` for that; this suite only confirms the adapter itself maps
 * to/from `domain_events` (§13.30.2) correctly.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;

describe('PrismaDomainEventRepository (integration)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const repository = new PrismaDomainEventRepository(prisma);
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.domainEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    await prisma.onModuleDestroy();
  });

  it('records a domain event with the correct type/payload, defaulting to pending status and zero dispatch attempts', async () => {
    const recorded = await repository.record({
      eventType: 'TransactionCommitted',
      payload: { transactionId: 'fake-txn-id', userId: 'fake-user-id' },
    });
    createdEventIds.push(recorded.id);

    expect(recorded.eventType).toBe('TransactionCommitted');
    expect(recorded.payload).toEqual({ transactionId: 'fake-txn-id', userId: 'fake-user-id' });
    expect(recorded.status).toBe('pending');
    expect(recorded.dispatchAttempts).toBe(0);
    expect(recorded.dispatchedAt).toBeNull();

    const row = await prisma.domainEvent.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(row.eventType).toBe('TransactionCommitted');
    expect(row.status).toBe('pending');
  });

  it('never sets dispatchedAt on creation (only a future dispatch worker, FR-DB-015, would do that)', async () => {
    const recorded = await repository.record({
      eventType: 'TransactionCommitted',
      payload: { transactionId: 'another-fake-id', userId: 'fake-user-id' },
    });
    createdEventIds.push(recorded.id);

    expect(recorded.dispatchedAt).toBeNull();
  });
});
