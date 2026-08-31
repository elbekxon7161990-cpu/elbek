import { describe, expect, it } from 'vitest';

import { FakeCommitIdempotencyLock } from './fake-commit-idempotency-lock.repository';

describe('FakeCommitIdempotencyLock', () => {
  it('claims an unclaimed key', async () => {
    const lock = new FakeCommitIdempotencyLock();

    await expect(lock.tryClaim('k', 30)).resolves.toBe(true);
  });

  it('rejects a second claim of the same key', async () => {
    const lock = new FakeCommitIdempotencyLock();
    await lock.tryClaim('k', 30);

    await expect(lock.tryClaim('k', 30)).resolves.toBe(false);
  });

  it('returns null for a claimed-but-unresolved key', async () => {
    const lock = new FakeCommitIdempotencyLock();
    await lock.tryClaim('k', 30);

    await expect(lock.getResult('k')).resolves.toBeNull();
  });

  it('returns the stored result once recorded', async () => {
    const lock = new FakeCommitIdempotencyLock();
    await lock.tryClaim('k', 30);
    await lock.storeResult('k', 'txn-1', 3600);

    await expect(lock.getResult('k')).resolves.toBe('txn-1');
  });

  it('allows reclaiming after release', async () => {
    const lock = new FakeCommitIdempotencyLock();
    await lock.tryClaim('k', 30);
    await lock.release('k');

    await expect(lock.tryClaim('k', 30)).resolves.toBe(true);
  });

  it('isolates unrelated keys', async () => {
    const lock = new FakeCommitIdempotencyLock();
    await lock.tryClaim('k1', 30);

    await expect(lock.tryClaim('k2', 30)).resolves.toBe(true);
  });
});
