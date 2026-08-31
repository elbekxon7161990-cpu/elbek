import type { LoanWizardStateRecord } from '../entities/loan-wizard-state.entity';

/**
 * TASK-FIN-004 (Stage I) — mirrors `isConversationStateExpired`'s own
 * read-time-check discipline (§5.19.2's principle, generalized here): a
 * record is expired once `expiresAt` has passed, regardless of whether
 * Redis's own TTL has actually reclaimed the key yet. Unlike
 * `ConversationStateRecord`'s `IDLE` state, every `LoanWizardStateRecord`
 * that exists at all is mid-dialog and always carries a real `expiresAt`
 * (no "idle, no TTL" case here — the absence of a wizard is represented by
 * the key not existing at all, not by a distinguished record).
 */
export function isLoanWizardStateExpired(record: LoanWizardStateRecord, now: string): boolean {
  return new Date(record.expiresAt).getTime() <= new Date(now).getTime();
}
