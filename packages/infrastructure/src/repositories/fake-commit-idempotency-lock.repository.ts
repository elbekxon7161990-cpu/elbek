import type { CommitIdempotencyLockPort } from '@afa/domain';

/**
 * A deterministic, in-memory `CommitIdempotencyLockPort` test double —
 * never wired into any production DI module. Ignores TTLs entirely (no
 * test in this codebase needs real expiry timing for this port; a claim
 * simply lives until `release`d or overwritten by `storeResult`).
 */
export class FakeCommitIdempotencyLock implements CommitIdempotencyLockPort {
  private readonly claims = new Map<string, string | null>();

  async tryClaim(key: string, _ttlSeconds: number): Promise<boolean> {
    if (this.claims.has(key)) {
      return false;
    }
    this.claims.set(key, null);
    return true;
  }

  async getResult(key: string): Promise<string | null> {
    return this.claims.get(key) ?? null;
  }

  async storeResult(key: string, result: string, _ttlSeconds: number): Promise<void> {
    this.claims.set(key, result);
  }

  async release(key: string): Promise<void> {
    this.claims.delete(key);
  }
}
