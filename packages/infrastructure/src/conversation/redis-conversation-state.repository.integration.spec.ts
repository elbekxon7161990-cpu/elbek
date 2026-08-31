import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ConversationStateRecord } from '@afa/domain';
import Redis from 'ioredis';

import { RedisConversationStateRepository } from './redis-conversation-state.repository';

process.env.REDIS_URL ??= 'redis://localhost:6379';

// TASK-MVP-002 — computed relative to real wall-clock time, not a fixed
// past date: a hardcoded absolute `expiresAt` eventually falls into the
// past as real time advances, which (correctly, per the repository's own
// "clamp to at least 1ms" behavior) makes every write expire before the
// test's very next read — a stale-fixture bug, not a repository bug.
const NOW_MS = Date.now();

function record(overrides: Partial<ConversationStateRecord> = {}): ConversationStateRecord {
  return {
    userId: 'integration-user-1',
    state: 'AWAITING_CLARIFICATION',
    contextPayload: {
      draftId: 'd',
      missingField: 'amount',
      retryCount: 0,
      lastQuestionAsked: null,
    },
    createdAt: new Date(NOW_MS).toISOString(),
    expiresAt: new Date(NOW_MS + 30 * 60 * 1000).toISOString(),
    version: 1,
    ...overrides,
  };
}

/**
 * Requires a real, reachable Redis (`REDIS_URL`). Same treatment as this
 * codebase's `prisma-*.repository.integration.spec.ts` files against a
 * real Postgres — this suite is expected to fail in an environment with no
 * live Redis, reported as ENVIRONMENT-BLOCKED rather than mocked away
 * (see this task's final report).
 */
describe('RedisConversationStateRepository (integration)', () => {
  const client = new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  const repository = new RedisConversationStateRepository(client);
  const userId = 'integration-user-1';

  beforeAll(async () => {
    await client.connect();
  });

  afterEach(async () => {
    await client.del(`conversation_state:${userId}`);
  });

  afterAll(async () => {
    await client.quit();
  });

  it('returns null for a user with no stored state', async () => {
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
      record({ version: 1, state: 'IDLE', contextPayload: null }),
    );

    expect(written).toBe(false);
    const stored = await repository.get(userId);
    expect(stored?.state).toBe('AWAITING_CLARIFICATION'); // unchanged
  });

  it('only one of two concurrent compare-and-set calls against the same expectedVersion succeeds (BR-CE-006 atomicity)', async () => {
    await repository.compareAndSet(userId, 0, record({ version: 1 }));

    const [first, second] = await Promise.all([
      repository.compareAndSet(
        userId,
        1,
        record({ version: 2, state: 'IDLE', contextPayload: null }),
      ),
      repository.compareAndSet(
        userId,
        1,
        record({
          version: 2,
          state: 'AWAITING_CONFIRMATION',
          contextPayload: { transactionId: 'txn-1', draftId: 'draft-1', flaggedFields: [] },
        }),
      ),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('sets a Redis TTL for a pending state and clears it for IDLE', async () => {
    await repository.compareAndSet(userId, 0, record({ version: 1 }));
    const pendingTtl = await client.pttl(`conversation_state:${userId}`);
    expect(pendingTtl).toBeGreaterThan(-1);

    await repository.compareAndSet(
      userId,
      1,
      record({ version: 2, state: 'IDLE', contextPayload: null, expiresAt: null }),
    );
    const idleTtl = await client.pttl(`conversation_state:${userId}`);
    expect(idleTtl).toBe(-1); // -1 = key exists, no TTL
  });
});
