import { describe, expect, it } from 'vitest';

import { computeReportCachePeriods, dedupeReportCachePeriods } from './report-cache-period';

describe('computeReportCachePeriods', () => {
  it('derives all five calendar periods for a given UTC date', () => {
    // 2026-01-15 is a Thursday.
    const periods = computeReportCachePeriods(new Date('2026-01-15T12:00:00Z'));

    expect(periods).toEqual([
      { reportType: 'daily', periodKey: '2026-01-15' },
      { reportType: 'weekly', periodKey: '2026-W03' },
      { reportType: 'monthly', periodKey: '2026-01' },
      { reportType: 'quarterly', periodKey: '2026-Q1' },
      { reportType: 'yearly', periodKey: '2026' },
    ]);
  });

  it('assigns the correct quarter for a month in each quarter boundary', () => {
    expect(computeReportCachePeriods(new Date('2026-03-31T00:00:00Z'))[3]).toEqual({
      reportType: 'quarterly',
      periodKey: '2026-Q1',
    });
    expect(computeReportCachePeriods(new Date('2026-04-01T00:00:00Z'))[3]).toEqual({
      reportType: 'quarterly',
      periodKey: '2026-Q2',
    });
    expect(computeReportCachePeriods(new Date('2026-07-01T00:00:00Z'))[3]).toEqual({
      reportType: 'quarterly',
      periodKey: '2026-Q3',
    });
    expect(computeReportCachePeriods(new Date('2026-10-01T00:00:00Z'))[3]).toEqual({
      reportType: 'quarterly',
      periodKey: '2026-Q4',
    });
  });

  it('handles the ISO week-numbering edge case at a year boundary (Dec 31 2025 is ISO week 1 of 2026)', () => {
    const periods = computeReportCachePeriods(new Date('2025-12-31T00:00:00Z'));
    const weekly = periods.find((p) => p.reportType === 'weekly');
    expect(weekly).toEqual({ reportType: 'weekly', periodKey: '2026-W01' });
  });

  it('handles the ISO week-numbering edge case at the other year boundary (Jan 1 2027 is ISO week 53 of 2026)', () => {
    const periods = computeReportCachePeriods(new Date('2027-01-01T00:00:00Z'));
    const weekly = periods.find((p) => p.reportType === 'weekly');
    expect(weekly).toEqual({ reportType: 'weekly', periodKey: '2026-W53' });
  });

  it('pads single-digit months/days/weeks to two digits', () => {
    const periods = computeReportCachePeriods(new Date('2026-02-03T00:00:00Z'));
    expect(periods.find((p) => p.reportType === 'daily')?.periodKey).toBe('2026-02-03');
  });
});

describe('dedupeReportCachePeriods', () => {
  it('collapses identical (reportType, periodKey) pairs', () => {
    const same = { reportType: 'monthly' as const, periodKey: '2026-01' };
    const result = dedupeReportCachePeriods([same, { ...same }]);
    expect(result).toHaveLength(1);
  });

  it('preserves distinct periods and their original order', () => {
    const a = { reportType: 'monthly' as const, periodKey: '2026-01' };
    const b = { reportType: 'monthly' as const, periodKey: '2026-02' };
    const result = dedupeReportCachePeriods([a, b, { ...a }]);
    expect(result).toEqual([a, b]);
  });
});
