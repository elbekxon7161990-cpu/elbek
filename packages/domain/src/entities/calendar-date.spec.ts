import { describe, expect, it } from 'vitest';

import { compareCalendarDateOnly } from './calendar-date';

describe('compareCalendarDateOnly', () => {
  it('returns 0 for two timestamps on the same UTC calendar day, regardless of time-of-day', () => {
    expect(
      compareCalendarDateOnly(new Date('2026-08-17T00:00:00Z'), new Date('2026-08-17T23:59:59Z')),
    ).toBe(0);
  });

  it('returns -1 when a is the previous UTC calendar day', () => {
    expect(
      compareCalendarDateOnly(new Date('2026-08-16T23:59:59Z'), new Date('2026-08-17T00:00:00Z')),
    ).toBe(-1);
  });

  it('returns 1 when a is the next UTC calendar day', () => {
    expect(
      compareCalendarDateOnly(new Date('2026-08-18T00:00:00Z'), new Date('2026-08-17T23:59:59Z')),
    ).toBe(1);
  });

  it('compares correctly across a month boundary', () => {
    expect(compareCalendarDateOnly(new Date('2026-09-01'), new Date('2026-08-31'))).toBe(1);
    expect(compareCalendarDateOnly(new Date('2026-08-31'), new Date('2026-09-01'))).toBe(-1);
  });

  it('compares correctly across a year boundary', () => {
    expect(compareCalendarDateOnly(new Date('2027-01-01'), new Date('2026-12-31'))).toBe(1);
    expect(compareCalendarDateOnly(new Date('2026-12-31'), new Date('2027-01-01'))).toBe(-1);
  });

  it('treats different times on the same UTC day as equal (0), even at the day boundary extremes', () => {
    expect(
      compareCalendarDateOnly(
        new Date('2026-08-17T00:00:00.000Z'),
        new Date('2026-08-17T00:00:00.001Z'),
      ),
    ).toBe(0);
    expect(
      compareCalendarDateOnly(new Date('2026-08-17T05:00:00Z'), new Date('2026-08-17T18:00:00Z')),
    ).toBe(0);
  });

  it('returns 0 (never throws) when a is an invalid Date, preserving each caller’s prior silent-pass behavior', () => {
    expect(compareCalendarDateOnly(new Date('invalid'), new Date('2026-08-17'))).toBe(0);
  });

  it('returns 0 (never throws) when b is an invalid Date', () => {
    expect(compareCalendarDateOnly(new Date('2026-08-17'), new Date('invalid'))).toBe(0);
  });

  it('returns 0 when both a and b are invalid Dates', () => {
    expect(compareCalendarDateOnly(new Date('invalid'), new Date('also invalid'))).toBe(0);
  });
});
