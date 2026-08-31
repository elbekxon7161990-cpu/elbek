import { describe, expect, it } from 'vitest';

import { computeDebtOverdueDays } from './compute-debt-overdue-days';

describe('computeDebtOverdueDays (TASK-REP-001 remaining scope, §9.1.4 Debt Summary Report)', () => {
  const asOf = new Date('2026-08-15T00:00:00Z');

  it('returns null when there is no due date at all', () => {
    expect(computeDebtOverdueDays(null, asOf)).toBeNull();
  });

  it('returns null when the due date is exactly today (not yet overdue)', () => {
    expect(computeDebtOverdueDays(new Date('2026-08-15'), asOf)).toBeNull();
  });

  it('returns null when the due date is in the future', () => {
    expect(computeDebtOverdueDays(new Date('2026-08-20'), asOf)).toBeNull();
  });

  it('returns the exact number of days overdue for a past due date', () => {
    expect(computeDebtOverdueDays(new Date('2026-08-10'), asOf)).toBe(5);
  });

  it('returns 1 for a due date exactly one day in the past', () => {
    expect(computeDebtOverdueDays(new Date('2026-08-14'), asOf)).toBe(1);
  });

  it('correctly counts across a month/year boundary', () => {
    expect(computeDebtOverdueDays(new Date('2025-12-20'), new Date('2026-01-05T00:00:00Z'))).toBe(
      16,
    );
  });
});
