/**
 * FR-SET-003 — thrown by `CategoryRepository.createCustomCategory()` when
 * the caller's (owner_user_id, language, lower(label)) partial unique index
 * (migration `20260830000000_custom_categories`) is already occupied — the
 * real, DB-level, concurrency-safe duplicate-create guard, distinct from
 * `isDuplicateCategoryName`'s own pre-check (fail-fast/friendly-error path,
 * not itself atomic under a genuine race). Mirrors `DuplicateBudgetError`'s
 * own "distinct, catchable signal" shape.
 */
export class DuplicateCategoryNameError extends Error {
  constructor(name: string) {
    super(`A category named "${name}" already exists.`);
    this.name = 'DuplicateCategoryNameError';
  }
}
