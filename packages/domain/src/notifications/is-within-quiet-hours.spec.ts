import { describe, expect, it } from 'vitest';

import { computeQuietHoursWindowEnd, isWithinQuietHours } from './is-within-quiet-hours';

const TASHKENT = 'Asia/Tashkent'; // UTC+5, no DST

describe('isWithinQuietHours (FR-NOT-003, default 22:00-08:00 user-local)', () => {
  it('is true late at night (23:00 local)', () => {
    // 18:00Z = 23:00 Tashkent
    expect(isWithinQuietHours(new Date('2026-01-15T18:00:00Z'), TASHKENT)).toBe(true);
  });

  it('is true just after midnight (03:00 local)', () => {
    // 22:00Z = 03:00 Tashkent (next day)
    expect(isWithinQuietHours(new Date('2026-01-15T22:00:00Z'), TASHKENT)).toBe(true);
  });

  it('is false during the daytime (14:00 local)', () => {
    // 09:00Z = 14:00 Tashkent
    expect(isWithinQuietHours(new Date('2026-01-15T09:00:00Z'), TASHKENT)).toBe(false);
  });

  it('is false exactly at the window start boundary check semantics (08:00 local, window end, exclusive)', () => {
    // 03:00Z = 08:00 Tashkent
    expect(isWithinQuietHours(new Date('2026-01-15T03:00:00Z'), TASHKENT)).toBe(false);
  });

  it('is true exactly at 22:00 local (window start, inclusive)', () => {
    // 17:00Z = 22:00 Tashkent
    expect(isWithinQuietHours(new Date('2026-01-15T17:00:00Z'), TASHKENT)).toBe(true);
  });

  it('respects a different timezone independently', () => {
    // UTC itself: 23:00 UTC = 23:00 in UTC timezone.
    expect(isWithinQuietHours(new Date('2026-01-15T23:00:00Z'), 'UTC')).toBe(true);
    expect(isWithinQuietHours(new Date('2026-01-15T12:00:00Z'), 'UTC')).toBe(false);
  });
});

describe('computeQuietHoursWindowEnd', () => {
  it('computes the correct next-day window end when currently in the evening', () => {
    // 18:00Z = 23:00 Tashkent Jan 15 -> window ends 08:00 Tashkent Jan 16 = 03:00Z Jan 16
    const result = computeQuietHoursWindowEnd(new Date('2026-01-15T18:00:00Z'), TASHKENT);
    expect(result.toISOString()).toBe('2026-01-16T03:00:00.000Z');
  });

  it('computes the correct same-day window end when currently past midnight', () => {
    // 22:00Z Jan15 = 03:00 Tashkent Jan 16 -> window ends 08:00 Tashkent Jan 16 = 03:00Z Jan 16
    const result = computeQuietHoursWindowEnd(new Date('2026-01-15T22:00:00Z'), TASHKENT);
    expect(result.toISOString()).toBe('2026-01-16T03:00:00.000Z');
  });
});
