/**
 * TASK-FIN-003 (BR-BUD-002 — "A category budget only counts expenses in
 * that exact category (not sub-categories rolled up automatically, unless
 * the budget is explicitly set on a parent category, in which case it
 * aggregates all child subcategories)").
 *
 * Only called for `scopeType === 'category'` budgets — an `'overall'`-scope
 * budget matches every expense unconditionally (BR-BUD-001's "EXPENSE-type
 * ... unless configured otherwise" is the only filter it needs), so this
 * function is never invoked for one.
 *
 * The category hierarchy (`categories.parent_category_id`, §13.8) is
 * exactly two levels deep — confirmed structurally, not assumed: `Transaction`
 * carries two separate FK columns, `categoryId` (always the top-level
 * category) and `subcategoryId` (always that category's own child, or
 * `null`) — there is no chain of subcategories-of-subcategories anywhere in
 * the schema. This makes the BR-BUD-002 match a single comparison, not a
 * recursive tree walk:
 *
 * - A budget whose own category row has `parentCategoryId === null` (it IS
 *   a top-level category) matches any transaction whose `categoryId` equals
 *   it — automatically "aggregating all child subcategories" for free,
 *   since `transactionCategoryId` is the parent regardless of which
 *   subcategory (if any) the transaction also carries.
 * - A budget whose own category row has a non-null `parentCategoryId` (it
 *   IS itself a subcategory) matches only transactions whose own
 *   `subcategoryId` equals it exactly — the "not sub-categories rolled up
 *   automatically" half of BR-BUD-002, for the case where the budget itself
 *   was set at the subcategory level.
 */
export function matchesBudgetCategoryScope(
  budgetCategoryId: string,
  budgetCategoryParentId: string | null,
  transactionCategoryId: string,
  transactionSubcategoryId: string | null,
): boolean {
  if (budgetCategoryParentId === null) {
    return transactionCategoryId === budgetCategoryId;
  }
  return transactionSubcategoryId === budgetCategoryId;
}
