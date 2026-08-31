import type { CustomCategoryWizardStateRecord } from './custom-category-wizard-state.entity';

/**
 * TASK-FIN-006 — mirrors `isLoanWizardStateExpired`'s own read-time-check
 * discipline: a record is expired once `expiresAt` has passed, regardless of
 * whether Redis's own TTL has actually reclaimed the key yet.
 */
export function isCustomCategoryWizardStateExpired(
  record: CustomCategoryWizardStateRecord,
  now: string,
): boolean {
  return new Date(record.expiresAt).getTime() <= new Date(now).getTime();
}
