import type { SearchSessionRecord } from '../entities/search-session.entity';

export const SEARCH_SESSION_REPOSITORY = Symbol('SEARCH_SESSION_REPOSITORY');

/**
 * TASK-FIN-012 — port for the `search_session:{user_id}` Redis key. Mirrors
 * `LoanWizardStateRepository`'s exact atomic-compare-and-set contract
 * (BR-CE-006's reasoning generalized: no naive read-then-write, so a lost
 * update under a genuine race is structurally impossible) — including the
 * same `compareAndSet(..., null)` "finish/cancel" sentinel, since this port
 * has no distinguished "idle" record either.
 */
export interface SearchSessionRepository {
  get(userId: string): Promise<SearchSessionRecord | null>;
  /** Returns `true` if the write (or delete, when `newRecord` is `null`) succeeded (version matched); `false` if a concurrent writer already changed the record. */
  compareAndSet(
    userId: string,
    expectedVersion: number,
    newRecord: SearchSessionRecord | null,
  ): Promise<boolean>;
}
