import { describe, expect, it } from 'vitest';

import type { BudgetThresholdCrossedPayload } from '../events/domain-event';
import { renderBudgetThresholdCrossedMessage } from './render-budget-notification-message';

const CATEGORY_PAYLOAD: BudgetThresholdCrossedPayload = {
  budgetId: 'budget-1',
  userId: 'user-1',
  scopeType: 'category',
  categoryName: 'FOOD_DINING',
  thresholdPercent: 90,
  utilizationPercent: 96,
  limitAmount: '900000.00',
  usedAmount: '864000.00',
  currency: 'RUB',
  periodStart: '2026-08-01',
};

describe('renderBudgetThresholdCrossedMessage', () => {
  it('renders a warning message (English) for a sub-100% threshold', () => {
    const message = renderBudgetThresholdCrossedMessage(CATEGORY_PAYLOAD, 'en');
    expect(message).toContain('90%');
    expect(message).toContain('FOOD_DINING');
    expect(message).toMatch(/warning/i);
  });

  it('renders a distinct "gone over" message for the 100% threshold', () => {
    const message = renderBudgetThresholdCrossedMessage(
      { ...CATEGORY_PAYLOAD, thresholdPercent: 100, utilizationPercent: 104 },
      'en',
    );
    expect(message).toMatch(/gone over/i);
  });

  it('renders in Uzbek', () => {
    const message = renderBudgetThresholdCrossedMessage(CATEGORY_PAYLOAD, 'uz');
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toMatch(/warning/i);
  });

  it('renders in Russian', () => {
    const message = renderBudgetThresholdCrossedMessage(CATEGORY_PAYLOAD, 'ru');
    expect(message.length).toBeGreaterThan(0);
  });

  it('renders "Overall" (localized) for an overall-scope budget with categoryName null', () => {
    const message = renderBudgetThresholdCrossedMessage(
      { ...CATEGORY_PAYLOAD, scopeType: 'overall', categoryName: null },
      'en',
    );
    expect(message).toContain('Overall');
  });
});
