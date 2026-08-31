import { describe, expect, it } from 'vitest';

import {
  SavingsGoal,
  type NewSavingsGoalValidationProps,
  type SavingsGoalProps,
} from './savings-goal.entity';
import { InvalidSavingsGoalError } from '../errors/invalid-savings-goal.error';

const FIXED_NOW = new Date('2026-08-17T12:00:00Z');

function makeProps(overrides: Partial<SavingsGoalProps> = {}): SavingsGoalProps {
  return {
    id: 'goal-1',
    userId: 'user-1',
    name: 'Vacation fund',
    targetAmount: '5000000.00',
    currency: 'UZS',
    targetDate: new Date('2026-12-01'),
    status: 'active',
    lastMilestoneFired: null,
    deletedAt: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

function makeNewProps(
  overrides: Partial<NewSavingsGoalValidationProps> = {},
): NewSavingsGoalValidationProps {
  return {
    userId: 'user-1',
    name: 'Vacation fund',
    targetAmount: '5000000.00',
    currency: 'UZS',
    targetDate: new Date('2026-12-01'),
    ...overrides,
  };
}

describe('SavingsGoal', () => {
  it('creates a valid savings goal (FR-FIN-011)', () => {
    const goal = new SavingsGoal(makeProps());

    expect(goal.name).toBe('Vacation fund');
    expect(goal.status).toBe('active');
    expect(goal.isCompleted).toBe(false);
  });

  it('accepts a null targetDate (FR-FIN-011 — optional)', () => {
    expect(() => new SavingsGoal(makeProps({ targetDate: null }))).not.toThrow();
  });

  it('rejects a non-positive targetAmount', () => {
    expect(() => new SavingsGoal(makeProps({ targetAmount: '0' }))).toThrow(
      InvalidSavingsGoalError,
    );
  });

  it('rejects a missing name', () => {
    expect(() => new SavingsGoal(makeProps({ name: '' }))).toThrow(InvalidSavingsGoalError);
  });

  it('rejects an invalid currency code', () => {
    expect(() => new SavingsGoal(makeProps({ currency: 'us' }))).toThrow(InvalidSavingsGoalError);
  });

  it('rejects an invalid status', () => {
    expect(() => new SavingsGoal(makeProps({ status: 'paused' as never }))).toThrow(
      InvalidSavingsGoalError,
    );
  });

  it('rejects an out-of-range lastMilestoneFired', () => {
    expect(() => new SavingsGoal(makeProps({ lastMilestoneFired: 0 }))).toThrow(
      InvalidSavingsGoalError,
    );
    expect(() => new SavingsGoal(makeProps({ lastMilestoneFired: 101 }))).toThrow(
      InvalidSavingsGoalError,
    );
    expect(() => new SavingsGoal(makeProps({ lastMilestoneFired: 25.5 }))).toThrow(
      InvalidSavingsGoalError,
    );
  });

  it('accepts a valid lastMilestoneFired', () => {
    expect(() => new SavingsGoal(makeProps({ lastMilestoneFired: 75 }))).not.toThrow();
  });

  describe('validateNew', () => {
    it('validates a well-formed new goal without throwing', () => {
      expect(() => SavingsGoal.validateNew(makeNewProps(), FIXED_NOW)).not.toThrow();
    });

    it('rejects a targetDate in the past (§8.9.4)', () => {
      expect(() =>
        SavingsGoal.validateNew(makeNewProps({ targetDate: new Date('2026-08-01') }), FIXED_NOW),
      ).toThrow(InvalidSavingsGoalError);
    });

    it('accepts a same-day targetDate (boundary)', () => {
      expect(() =>
        SavingsGoal.validateNew(makeNewProps({ targetDate: new Date('2026-08-17') }), FIXED_NOW),
      ).not.toThrow();
    });

    it('accepts a null targetDate without a past-date check', () => {
      expect(() =>
        SavingsGoal.validateNew(makeNewProps({ targetDate: null }), FIXED_NOW),
      ).not.toThrow();
    });
  });

  describe('evaluateCompletion (FR-FIN-014)', () => {
    it('transitions active -> completed when progress reaches exactly 100%', () => {
      const goal = new SavingsGoal(makeProps({ status: 'active' }));

      const result = goal.evaluateCompletion(100);

      expect(result.status).toBe('completed');
      expect(result.isCompleted).toBe(true);
    });

    it('transitions active -> completed when progress exceeds 100%', () => {
      const goal = new SavingsGoal(makeProps({ status: 'active' }));

      expect(goal.evaluateCompletion(142).status).toBe('completed');
    });

    it('stays active when progress is below 100%', () => {
      const goal = new SavingsGoal(makeProps({ status: 'active' }));

      expect(goal.evaluateCompletion(99).status).toBe('active');
    });

    it('is idempotent — further contributions past 100% keep it completed, never error (FR-FIN-014)', () => {
      const goal = new SavingsGoal(makeProps({ status: 'completed' }));

      expect(() => goal.evaluateCompletion(120)).not.toThrow();
      expect(goal.evaluateCompletion(120).status).toBe('completed');
    });
  });

  it('isDeleted reflects deletedAt', () => {
    expect(new SavingsGoal(makeProps()).isDeleted).toBe(false);
    expect(new SavingsGoal(makeProps({ deletedAt: FIXED_NOW })).isDeleted).toBe(true);
  });
});
