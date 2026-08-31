import { describe, expect, it } from 'vitest';

import {
  classifyDebtReminderCondition,
  toLocalCalendarDate,
} from './classify-debt-reminder-condition';

describe('toLocalCalendarDate', () => {
  it('resolves the correct local calendar date across a UTC day boundary', () => {
    // 22:00 UTC Jan 15 = 03:00 Tashkent (UTC+5) Jan 16.
    const result = toLocalCalendarDate(new Date('2026-01-15T22:00:00Z'), 'Asia/Tashkent');
    expect(result.toISOString()).toBe('2026-01-16T00:00:00.000Z');
  });

  it('returns the same day for a timezone with no offset', () => {
    const result = toLocalCalendarDate(new Date('2026-01-15T12:00:00Z'), 'UTC');
    expect(result.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('classifyDebtReminderCondition (FR-DBT-007)', () => {
  const today = new Date('2026-08-15T00:00:00Z');

  it('classifies a debt due exactly today as "approaching" (on the due date itself)', () => {
    expect(classifyDebtReminderCondition(new Date('2026-08-15'), today)).toBe('approaching');
  });

  it('classifies a debt due tomorrow as "approaching" (1 day before)', () => {
    expect(classifyDebtReminderCondition(new Date('2026-08-16'), today)).toBe('approaching');
  });

  it('classifies a debt due yesterday as "overdue"', () => {
    expect(classifyDebtReminderCondition(new Date('2026-08-14'), today)).toBe('overdue');
  });

  it('classifies a debt overdue by a long time as still "overdue" (no arbitrary cutoff — "until resolved")', () => {
    expect(classifyDebtReminderCondition(new Date('2024-01-01'), today)).toBe('overdue');
  });

  it('classifies a debt due 2 days from now as "none" (not yet within the approaching window)', () => {
    expect(classifyDebtReminderCondition(new Date('2026-08-17'), today)).toBe('none');
  });

  it('classifies a debt due far in the future as "none"', () => {
    expect(classifyDebtReminderCondition(new Date('2026-12-01'), today)).toBe('none');
  });
});
