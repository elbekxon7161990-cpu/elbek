import { describe, expect, it } from 'vitest';

import { computeCurrentDateTimeInTimezone } from './compute-current-date-time-in-timezone';

describe('computeCurrentDateTimeInTimezone', () => {
  it('formats a UTC instant in a positive-offset timezone (Asia/Tashkent, UTC+5, no DST)', () => {
    const now = new Date('2026-08-14T05:30:00.000Z');

    expect(computeCurrentDateTimeInTimezone(now, 'Asia/Tashkent')).toBe(
      '2026-08-14T10:30:00+05:00',
    );
  });

  it('formats a UTC instant in UTC itself as +00:00', () => {
    const now = new Date('2026-08-14T05:30:00.000Z');

    expect(computeCurrentDateTimeInTimezone(now, 'UTC')).toBe('2026-08-14T05:30:00+00:00');
  });

  it('rolls over to the next calendar day when the offset pushes past midnight', () => {
    const now = new Date('2026-08-14T20:30:00.000Z');

    expect(computeCurrentDateTimeInTimezone(now, 'Asia/Tashkent')).toBe(
      '2026-08-15T01:30:00+05:00',
    );
  });

  it("falls back to the instant's own ISO string for an invalid timezone rather than throwing", () => {
    const now = new Date('2026-08-14T05:30:00.000Z');

    expect(computeCurrentDateTimeInTimezone(now, 'Not/ARealZone')).toBe(now.toISOString());
  });
});
