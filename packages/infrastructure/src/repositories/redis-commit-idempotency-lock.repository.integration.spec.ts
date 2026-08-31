import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';

import { RedisCommitIdempotencyLock } from './redis-commit-idempotency-lock.repository';

process.env.REDIS_URL ??= 'redis://localhost:6379';

/**
 * Requires a real, reachable Redis (`REDIS_URL`). Same treatment as this
 * codebase's other Redis-backed integration specs (`redis-conversation-state.repository.integration.spec.ts`,
 * TASK-BOT-002) — expected to fail in an environment with no live Redis,
 * reported as ENVIRONMENT-BLOCKED rather than mocked away.
 */
describe('RedisCommitIdempotencyLock (integration)', () => {
  const client = new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  const lock = new RedisCommitIdempotencyLock(client);
  const key = 'transaction_commit:integration-user:draft-1';

  beforeAll(async () => {
    await client.connect();
  });

  afterEach(async () => {
    await client.del(key);
  });

  afterAll(async () => {
    await client.quit();
  });

  it('claims an unclaimed key', async () => {
    await expect(lock.tryClaim(key, 30)).resolves.toBe(true);
  });

  it('rejects a second claim of the same key while the first is still pending', async () => {
    await lock.tryClaim(key, 30);
    await expect(lock.tryClaim(key, 30)).resolves.toBe(false);
  });

  it('returns null for an unresolved (still-pending) claim', async () => {
    await lock.tryClaim(key, 30);
    await expect(lock.getResult(key)).resolves.toBeNull();
  });

  it('returns the stored result once one has been recorded', async () => {
    await lock.tryClaim(key, 30);
    await lock.storeResult(key, 'txn-real-1', 3600);
    await expect(lock.getResult(key)).resolves.toBe('txn-real-1');
  });

  it('allows reclaiming after release', async () => {
    await lock.tryClaim(key, 30);
    await lock.release(key);
    await expect(lock.tryClaim(key, 30)).resolves.toBe(true);
  });

  it('only one of two concurrent claims for the same key succeeds (BR-CE-006-style atomicity)', async () => {
    const [first, second] = await Promise.all([lock.tryClaim(key, 30), lock.tryClaim(key, 30)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});
