import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { LoanWizardStateRecord } from '@afa/domain';
import Redis from 'ioredis';

import { RedisLoanWizardStateRepository } from './redis-loan-wizard-state.repository';

process.env.REDIS_URL ??= 'redis://localhost:6379';

// TASK-FIN-004 (Stage I) — computed relative to real wall-clock time, same
// reasoning `redis-conversation-state.repository.integration.spec.ts` own
// comment already documents: a fixed absolute `expiresAt` eventually falls
// into the past as real time advances.
const NOW_MS = Date.now();

function record(overrides: Partial<LoanWizardStateRecord> = {}): LoanWizardStateRecord {
  return {
    version: 1,
    step: 'AWAITING_LENDER',
    createDraft: {},
    paymentDraft: null,
    expiresAt: new Date(NOW_MS + 10 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/**
 * Requires a real, reachable Redis (`REDIS_URL`) — same ENVIRONMENT-BLOCKED
 * treatment every other real-infrastructure suite in this codebase follows.
 */
describe('RedisLoanWizardStateRepository (integration)', () => {
  const client = new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  const repository = new RedisLoanWizardStateRepository(client);
  const userId = 'loan-wizard-integration-user-1';

  beforeAll(async () => {
    await client.connect();
  });

  afterEach(async () => {
    await client.del(`loan_wizard:${userId}`);
  });

  afterAll(async () => {
    await client.quit();
  });

  it('returns null for a user with no active wizard', async () => {
    await expect(repository.get(userId)).resolves.toBeNull();
  });

  it('writes and reads back a record via a successful compare-and-set from version 0', async () => {
    const written = await repository.compareAndSet(userId, 0, record({ version: 1 }));
    expect(written).toBe(true);

    const stored = await repository.get(userId);
    expect(stored).toEqual(record({ version: 1 }));
  });

  it('rejects a compare-and-set whose expectedVersion does not match the stored version', async () => {
    await repository.compareAndSet(userId, 0, record({ version: 1 }));

    const written = await repository.compareAndSet(
      userId,
      0,
      record({ version: 1, step: 'AWAITING_PRINCIPAL' }),
    );

    expect(written).toBe(false);
    const stored = await repository.get(userId);
    expect(stored?.step).toBe('AWAITING_LENDER'); // unchanged
  });

  it('only one of two concurrent compare-and-set calls against the same expectedVersion succeeds (no lost update)', async () => {
    await repository.compareAndSet(userId, 0, record({ version: 1 }));

    const [first, second] = await Promise.all([
      repository.compareAndSet(userId, 1, record({ version: 2, step: 'AWAITING_PRINCIPAL' })),
      repository.compareAndSet(userId, 1, record({ version: 2, step: 'AWAITING_CURRENCY' })),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('deletes the key when compareAndSet is called with a null record (finish/cancel), and a version mismatch does not delete', async () => {
    await repository.compareAndSet(userId, 0, record({ version: 1 }));

    const deniedDelete = await repository.compareAndSet(userId, 0, null);
    expect(deniedDelete).toBe(false);
    await expect(repository.get(userId)).resolves.not.toBeNull();

    const allowedDelete = await repository.compareAndSet(userId, 1, null);
    expect(allowedDelete).toBe(true);
    await expect(repository.get(userId)).resolves.toBeNull();
  });

  it('sets a Redis TTL matching the record’s own expiresAt', async () => {
    await repository.compareAndSet(userId, 0, record({ version: 1 }));
    const ttl = await client.pttl(`loan_wizard:${userId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
  });
});
