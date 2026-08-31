import { describe, expect, it } from 'vitest';

import { calculateNextLoanDueDate } from './calculate-next-loan-due-date';

describe('calculateNextLoanDueDate (TASK-FIN-004 Stage I, FR-FIN-009)', () => {
  it('weekly: the first due date is exactly 7 days after startDate', () => {
    const result = calculateNextLoanDueDate(
      new Date('2026-08-01T00:00:00Z'),
      'weekly',
      new Date('2026-08-01T00:00:00Z'),
    );
    expect(result.toISOString()).toBe('2026-08-08T00:00:00.000Z');
  });

  it('monthly: the first due date is exactly 1 calendar month after startDate', () => {
    const result = calculateNextLoanDueDate(
      new Date('2026-08-01T00:00:00Z'),
      'monthly',
      new Date('2026-08-01T00:00:00Z'),
    );
    expect(result.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('quarterly: the first due date is exactly 3 calendar months after startDate', () => {
    const result = calculateNextLoanDueDate(
      new Date('2026-08-01T00:00:00Z'),
      'quarterly',
      new Date('2026-08-01T00:00:00Z'),
    );
    expect(result.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('exact start date: asOfDate === startDate returns the first (not-yet-elapsed) installment', () => {
    const startDate = new Date('2026-08-17T00:00:00Z');
    const result = calculateNextLoanDueDate(startDate, 'monthly', startDate);
    expect(result.toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('the day after startDate: still returns the first installment (nothing has elapsed yet)', () => {
    const result = calculateNextLoanDueDate(
      new Date('2026-08-17T00:00:00Z'),
      'monthly',
      new Date('2026-08-18T00:00:00Z'),
    );
    expect(result.toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('multiple elapsed installments: skips every past-due date and returns the next upcoming one', () => {
    // monthly from Jan 1: Feb1, Mar1, Apr1, May1... asOfDate = Apr 15 -> May1
    // (Feb1/Mar1/Apr1 are all strictly before Apr15, so all three are skipped).
    const result = calculateNextLoanDueDate(
      new Date('2026-01-01T00:00:00Z'),
      'monthly',
      new Date('2026-04-15T00:00:00Z'),
    );
    expect(result.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('a due date exactly equal to asOfDate is returned as-is (not treated as elapsed)', () => {
    const result = calculateNextLoanDueDate(
      new Date('2026-01-01T00:00:00Z'),
      'weekly',
      new Date('2026-01-08T00:00:00Z'),
    );
    expect(result.toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });

  it('quarterly with multiple elapsed periods', () => {
    // quarterly from Jan1: Apr1, Jul1, Oct1... asOfDate = Sep 1 -> Oct1
    const result = calculateNextLoanDueDate(
      new Date('2026-01-01T00:00:00Z'),
      'quarterly',
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(result.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('disclosed month-end overflow behavior: Jan 31 + 1 month lands on Mar 3 in a non-leap year (standard JS Date semantics, no PRD formula to contradict)', () => {
    const result = calculateNextLoanDueDate(
      new Date('2025-01-31T00:00:00Z'),
      'monthly',
      new Date('2025-01-31T00:00:00Z'),
    );
    expect(result.toISOString()).toBe('2025-03-03T00:00:00.000Z');
  });
});
