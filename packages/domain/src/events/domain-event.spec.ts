import { describe, expect, it } from 'vitest';

import {
  parseBudgetThresholdCrossedPayload,
  parseGoalCompletedPayload,
  parseGoalMilestoneReachedPayload,
} from './domain-event';

const VALID_PAYLOAD = {
  budgetId: 'budget-1',
  userId: 'user-1',
  scopeType: 'category' as const,
  categoryName: 'Groceries',
  thresholdPercent: 90,
  utilizationPercent: 96,
  limitAmount: '900000.00',
  usedAmount: '864000.00',
  currency: 'RUB',
  periodStart: '2026-08-01',
};

describe('parseBudgetThresholdCrossedPayload (TASK-FIN-003)', () => {
  it('parses a well-formed payload', () => {
    expect(parseBudgetThresholdCrossedPayload(VALID_PAYLOAD)).toEqual(VALID_PAYLOAD);
  });

  it('accepts a null categoryName (overall-scope budget)', () => {
    const payload = { ...VALID_PAYLOAD, scopeType: 'overall' as const, categoryName: null };
    expect(parseBudgetThresholdCrossedPayload(payload).categoryName).toBeNull();
  });

  it('throws on a missing required field', () => {
    const rest: Record<string, unknown> = { ...VALID_PAYLOAD };
    delete rest.budgetId;
    expect(() => parseBudgetThresholdCrossedPayload(rest)).toThrow(/Malformed/);
  });

  it('throws on an invalid scopeType', () => {
    expect(() =>
      parseBudgetThresholdCrossedPayload({ ...VALID_PAYLOAD, scopeType: 'bogus' }),
    ).toThrow(/Malformed/);
  });

  it('throws when thresholdPercent is not a finite number', () => {
    expect(() =>
      parseBudgetThresholdCrossedPayload({ ...VALID_PAYLOAD, thresholdPercent: 'ninety' }),
    ).toThrow(/Malformed/);
  });
});

const VALID_MILESTONE_PAYLOAD = {
  goalId: 'goal-1',
  userId: 'user-1',
  name: 'Vacation fund',
  thresholdPercent: 50,
  progressPercent: 52,
  targetAmount: '5000000.00',
  currency: 'UZS',
};

describe('parseGoalMilestoneReachedPayload (TASK-FIN-004, FR-FIN-013)', () => {
  it('parses a well-formed payload', () => {
    expect(parseGoalMilestoneReachedPayload(VALID_MILESTONE_PAYLOAD)).toEqual(
      VALID_MILESTONE_PAYLOAD,
    );
  });

  it('throws on a missing required field', () => {
    const rest: Record<string, unknown> = { ...VALID_MILESTONE_PAYLOAD };
    delete rest.goalId;
    expect(() => parseGoalMilestoneReachedPayload(rest)).toThrow(/Malformed/);
  });

  it('throws when thresholdPercent is not a finite number', () => {
    expect(() =>
      parseGoalMilestoneReachedPayload({ ...VALID_MILESTONE_PAYLOAD, thresholdPercent: 'fifty' }),
    ).toThrow(/Malformed/);
  });

  it('throws when progressPercent is not a finite number', () => {
    expect(() =>
      parseGoalMilestoneReachedPayload({ ...VALID_MILESTONE_PAYLOAD, progressPercent: null }),
    ).toThrow(/Malformed/);
  });
});

const VALID_COMPLETED_PAYLOAD = {
  goalId: 'goal-1',
  userId: 'user-1',
  name: 'Vacation fund',
  targetAmount: '5000000.00',
  currency: 'UZS',
};

describe('parseGoalCompletedPayload (TASK-FIN-004, FR-FIN-014)', () => {
  it('parses a well-formed payload', () => {
    expect(parseGoalCompletedPayload(VALID_COMPLETED_PAYLOAD)).toEqual(VALID_COMPLETED_PAYLOAD);
  });

  it('throws on a missing required field', () => {
    const rest: Record<string, unknown> = { ...VALID_COMPLETED_PAYLOAD };
    delete rest.targetAmount;
    expect(() => parseGoalCompletedPayload(rest)).toThrow(/Malformed/);
  });

  it('throws when name is empty', () => {
    expect(() => parseGoalCompletedPayload({ ...VALID_COMPLETED_PAYLOAD, name: '' })).toThrow(
      /Malformed/,
    );
  });
});
