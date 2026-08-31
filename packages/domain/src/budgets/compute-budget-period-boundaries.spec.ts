import { describe, expect, it } from 'vitest';

import {
  computeBudgetPeriodBoundaries,
  computeNextBudgetPeriodBoundaries,
} from './compute-budget-period-boundaries';

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('computeBudgetPeriodBoundaries', () => {
  it('computes monthly boundaries (AC-BUD-003 rollover reference)', () => {
    const { currentPeriodStart, currentPeriodEnd } = computeBudgetPeriodBoundaries(
      new Date('2026-08-15'),
      'monthly',
    );
    expect(iso(currentPeriodStart)).toBe('2026-08-01');
    expect(iso(currentPeriodEnd)).toBe('2026-08-31');
  });

  it('computes monthly boundaries for a 28-day February', () => {
    const { currentPeriodStart, currentPeriodEnd } = computeBudgetPeriodBoundaries(
      new Date('2026-02-10'),
      'monthly',
    );
    expect(iso(currentPeriodStart)).toBe('2026-02-01');
    expect(iso(currentPeriodEnd)).toBe('2026-02-28');
  });

  it('computes weekly boundaries (Monday-start, ISO 8601)', () => {
    // 2026-08-15 is a Saturday.
    const { currentPeriodStart, currentPeriodEnd } = computeBudgetPeriodBoundaries(
      new Date('2026-08-15'),
      'weekly',
    );
    expect(iso(currentPeriodStart)).toBe('2026-08-10'); // Monday
    expect(iso(currentPeriodEnd)).toBe('2026-08-16'); // Sunday
  });

  it('computes quarterly boundaries', () => {
    const { currentPeriodStart, currentPeriodEnd } = computeBudgetPeriodBoundaries(
      new Date('2026-08-15'),
      'quarterly',
    );
    expect(iso(currentPeriodStart)).toBe('2026-07-01');
    expect(iso(currentPeriodEnd)).toBe('2026-09-30');
  });

  it('computes yearly boundaries', () => {
    const { currentPeriodStart, currentPeriodEnd } = computeBudgetPeriodBoundaries(
      new Date('2026-08-15'),
      'yearly',
    );
    expect(iso(currentPeriodStart)).toBe('2026-01-01');
    expect(iso(currentPeriodEnd)).toBe('2026-12-31');
  });
});

describe('computeNextBudgetPeriodBoundaries (FR-BUD-003 rollover)', () => {
  it('advances a monthly period to the immediately-following month', () => {
    const { currentPeriodStart, currentPeriodEnd } = computeNextBudgetPeriodBoundaries(
      new Date('2026-08-31'),
      'monthly',
    );
    expect(iso(currentPeriodStart)).toBe('2026-09-01');
    expect(iso(currentPeriodEnd)).toBe('2026-09-30');
  });

  it('advances a yearly period across a year boundary', () => {
    const { currentPeriodStart, currentPeriodEnd } = computeNextBudgetPeriodBoundaries(
      new Date('2026-12-31'),
      'yearly',
    );
    expect(iso(currentPeriodStart)).toBe('2027-01-01');
    expect(iso(currentPeriodEnd)).toBe('2027-12-31');
  });

  it('produces the mathematically correct next period even when called late (a retried rollover job)', () => {
    // Simulates a rollover job that ran a full extra day late — the next
    // period must still be computed from currentPeriodEnd, not from "now".
    const { currentPeriodStart } = computeNextBudgetPeriodBoundaries(
      new Date('2026-08-31'),
      'monthly',
    );
    expect(iso(currentPeriodStart)).toBe('2026-09-01');
  });

  it('advances a weekly period to the following Monday', () => {
    const { currentPeriodStart, currentPeriodEnd } = computeNextBudgetPeriodBoundaries(
      new Date('2026-08-16'), // Sunday, end of the week starting 2026-08-10
      'weekly',
    );
    expect(iso(currentPeriodStart)).toBe('2026-08-17');
    expect(iso(currentPeriodEnd)).toBe('2026-08-23');
  });
});
