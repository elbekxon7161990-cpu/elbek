import type { SearchSessionRecord } from '../entities/search-session.entity';

/**
 * TASK-FIN-012 — mirrors `isLoanWizardStateExpired`'s own read-time-check
 * discipline: a record is expired once `expiresAt` has passed, regardless of
 * whether Redis's own TTL has actually reclaimed the key yet.
 */
export function isSearchSessionExpired(record: SearchSessionRecord, now: string): boolean {
  return new Date(record.expiresAt).getTime() <= new Date(now).getTime();
}
