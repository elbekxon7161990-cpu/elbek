/**
 * §8.4.7 — "User attempts to create a duplicate budget for the same
 * category + period type -> System offers to update the existing budget
 * instead of creating a conflicting second one." Thrown by
 * `BudgetRepository.create()` when the caller's `(userId, categoryId,
 * periodType)` (category scope) or `(userId, periodType)` (overall scope)
 * partial-unique constraint (§13.7, `schema.prisma`'s own comment on
 * `Budget`) is already occupied by a non-deleted budget — a distinct,
 * catchable signal the application layer uses to offer the "update instead"
 * path, never to reject outright with a generic validation error.
 */
export class DuplicateBudgetError extends Error {
  readonly existingBudgetId: string;

  constructor(existingBudgetId: string) {
    super(`A budget already exists for this scope (existing budget id: ${existingBudgetId}).`);
    this.name = 'DuplicateBudgetError';
    this.existingBudgetId = existingBudgetId;
  }
}
