import type { LoanWizardStateRecord } from '../entities/loan-wizard-state.entity';

export const LOAN_WIZARD_STATE_REPOSITORY = Symbol('LOAN_WIZARD_STATE_REPOSITORY');

/**
 * TASK-FIN-004 (Stage I) — port for the `loan_wizard:{user_id}` Redis key.
 * Mirrors `ConversationStateRepository`'s exact atomic-compare-and-set
 * contract (BR-CE-006's reasoning generalized: no naive read-then-write, so
 * a lost update under a genuine race is structurally impossible) — the one
 * difference is `compareAndSet` accepts `null` here to represent
 * "finish/cancel the wizard" (delete the key), since this port has no
 * distinguished "IDLE" record the way `ConversationStateRecord` does.
 */
export interface LoanWizardStateRepository {
  get(userId: string): Promise<LoanWizardStateRecord | null>;
  /** Returns `true` if the write (or delete, when `newRecord` is `null`) succeeded (version matched); `false` if a concurrent writer already changed the record. */
  compareAndSet(
    userId: string,
    expectedVersion: number,
    newRecord: LoanWizardStateRecord | null,
  ): Promise<boolean>;
}
