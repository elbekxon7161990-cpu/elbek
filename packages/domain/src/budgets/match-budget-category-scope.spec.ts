import { describe, expect, it } from 'vitest';

import { matchesBudgetCategoryScope } from './match-budget-category-scope';

describe('matchesBudgetCategoryScope (BR-BUD-002)', () => {
  it('a budget on a top-level category matches a transaction tagged directly with that category', () => {
    expect(matchesBudgetCategoryScope('food', null, 'food', null)).toBe(true);
  });

  it('a budget on a top-level category matches a transaction tagged with any of its subcategories ("aggregates all child subcategories")', () => {
    expect(matchesBudgetCategoryScope('food', null, 'food', 'restaurants')).toBe(true);
    expect(matchesBudgetCategoryScope('food', null, 'food', 'groceries')).toBe(true);
  });

  it('a budget on a top-level category does not match a transaction under a different top-level category', () => {
    expect(matchesBudgetCategoryScope('food', null, 'transport', null)).toBe(false);
  });

  it('a budget on a specific subcategory matches only that exact subcategory ("not sub-categories rolled up automatically")', () => {
    expect(matchesBudgetCategoryScope('restaurants', 'food', 'food', 'restaurants')).toBe(true);
  });

  it('a budget on a specific subcategory does NOT match a transaction tagged with a sibling subcategory of the same parent', () => {
    expect(matchesBudgetCategoryScope('restaurants', 'food', 'food', 'groceries')).toBe(false);
  });

  it('a budget on a specific subcategory does not match a transaction with no subcategory at all (only the parent)', () => {
    expect(matchesBudgetCategoryScope('restaurants', 'food', 'food', null)).toBe(false);
  });
});
