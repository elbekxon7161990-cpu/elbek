import { describe, expect, it } from 'vitest';

import {
  computeDailyBoundary,
  computeMonthlyBoundary,
  computeQuarterlyBoundary,
  computeWeeklyBoundary,
  computeYearlyBoundary,
} from './report-period-boundaries';

describe('computeDailyBoundary', () => {
  it("derives today's [start, end) range and the matching period key", () => {
    const boundary = computeDailyBoundary(new Date('2026-01-15T14:30:00Z'));
    expect(boundary.reportType).toBe('daily');
    expect(boundary.periodKey).toBe('2026-01-15');
    expect(boundary.current.start.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(boundary.current.end.toISOString()).toBe('2026-01-16T00:00:00.000Z');
  });

  it('derives the immediately-prior day as the comparison period', () => {
    const boundary = computeDailyBoundary(new Date('2026-01-15T14:30:00Z'));
    expect(boundary.prior.start.toISOString()).toBe('2026-01-14T00:00:00.000Z');
    expect(boundary.prior.end.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(boundary.priorPeriodKey).toBe('2026-01-14');
  });

  it('handles a month/year boundary correctly (Jan 1 prior day is Dec 31 of the prior year)', () => {
    const boundary = computeDailyBoundary(new Date('2026-01-01T00:00:00Z'));
    expect(boundary.prior.start.toISOString()).toBe('2025-12-31T00:00:00.000Z');
    expect(boundary.priorPeriodKey).toBe('2025-12-31');
  });
});

describe('computeWeeklyBoundary', () => {
  it('derives the ISO (Monday-start) week range and matching period key', () => {
    // 2026-01-15 is a Thursday; that ISO week (W03) runs Mon 2026-01-12 .. Mon 2026-01-19.
    const boundary = computeWeeklyBoundary(new Date('2026-01-15T14:30:00Z'));
    expect(boundary.reportType).toBe('weekly');
    expect(boundary.periodKey).toBe('2026-W03');
    expect(boundary.current.start.toISOString()).toBe('2026-01-12T00:00:00.000Z');
    expect(boundary.current.end.toISOString()).toBe('2026-01-19T00:00:00.000Z');
  });

  it('derives the immediately-prior 7-day week as the comparison period', () => {
    const boundary = computeWeeklyBoundary(new Date('2026-01-15T14:30:00Z'));
    expect(boundary.prior.start.toISOString()).toBe('2026-01-05T00:00:00.000Z');
    expect(boundary.prior.end.toISOString()).toBe('2026-01-12T00:00:00.000Z');
    expect(boundary.priorPeriodKey).toBe('2026-W02');
  });

  it('works when "today" is itself a Monday (start of its own week)', () => {
    const boundary = computeWeeklyBoundary(new Date('2026-01-12T00:00:00Z'));
    expect(boundary.current.start.toISOString()).toBe('2026-01-12T00:00:00.000Z');
  });
});

describe('computeMonthlyBoundary', () => {
  it('derives the current calendar month range and matching period key', () => {
    const boundary = computeMonthlyBoundary(new Date('2026-01-15T14:30:00Z'));
    expect(boundary.reportType).toBe('monthly');
    expect(boundary.periodKey).toBe('2026-01');
    expect(boundary.current.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(boundary.current.end.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('derives the immediately-prior month as the comparison period', () => {
    const boundary = computeMonthlyBoundary(new Date('2026-03-15T00:00:00Z'));
    expect(boundary.prior.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(boundary.prior.end.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(boundary.priorPeriodKey).toBe('2026-02');
  });

  it('handles a year boundary correctly (January prior month is December of the prior year)', () => {
    const boundary = computeMonthlyBoundary(new Date('2026-01-15T00:00:00Z'));
    expect(boundary.prior.start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(boundary.prior.end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(boundary.priorPeriodKey).toBe('2025-12');
  });
});

describe('computeQuarterlyBoundary', () => {
  it('derives the current calendar quarter and matching period key', () => {
    const boundary = computeQuarterlyBoundary(new Date('2026-02-10T00:00:00Z')); // Q1
    expect(boundary.reportType).toBe('quarterly');
    expect(boundary.periodKey).toBe('2026-Q1');
    expect(boundary.current.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(boundary.current.end.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('derives the immediately-prior quarter, crossing a year boundary correctly', () => {
    const boundary = computeQuarterlyBoundary(new Date('2026-02-10T00:00:00Z')); // Q1 2026 -> prior is Q4 2025
    expect(boundary.prior.start.toISOString()).toBe('2025-10-01T00:00:00.000Z');
    expect(boundary.prior.end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(boundary.priorPeriodKey).toBe('2025-Q4');
  });
});

describe('computeYearlyBoundary', () => {
  it('derives the current calendar year and matching period key', () => {
    const boundary = computeYearlyBoundary(new Date('2026-07-04T00:00:00Z'));
    expect(boundary.reportType).toBe('yearly');
    expect(boundary.periodKey).toBe('2026');
    expect(boundary.current.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(boundary.current.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('derives the immediately-prior year as the comparison period', () => {
    const boundary = computeYearlyBoundary(new Date('2026-07-04T00:00:00Z'));
    expect(boundary.prior.start.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(boundary.prior.end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(boundary.priorPeriodKey).toBe('2025');
  });
});
