import type { CustomCategoryWizardStateRecord } from '../entities/custom-category-wizard-state.entity';

export const CUSTOM_CATEGORY_WIZARD_STATE_REPOSITORY = Symbol(
  'CUSTOM_CATEGORY_WIZARD_STATE_REPOSITORY',
);

/**
 * TASK-FIN-006 — port for the `custom_category_wizard:{user_id}` Redis key.
 * Mirrors `LoanWizardStateRepository`'s exact atomic-compare-and-set
 * contract (BR-CE-006's reasoning generalized: no naive read-then-write, so
 * a lost update under a genuine race is structurally impossible) — including
 * accepting `null` to mean "finish/cancel the wizard" (delete the key).
 */
export interface CustomCategoryWizardStateRepository {
  get(userId: string): Promise<CustomCategoryWizardStateRecord | null>;
  /** Returns `true` if the write (or delete, when `newRecord` is `null`) succeeded (version matched); `false` if a concurrent writer already changed the record. */
  compareAndSet(
    userId: string,
    expectedVersion: number,
    newRecord: CustomCategoryWizardStateRecord | null,
  ): Promise<boolean>;
}
