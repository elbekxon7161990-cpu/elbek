import { describe, expect, it } from 'vitest';

import { resolveUserLocalReferenceDate } from './resolve-user-local-reference-date';

describe('resolveUserLocalReferenceDate', () => {
  it('returns the UTC calendar date for a UTC user', () => {
    const instant = new Date('2026-08-13T12:00:00Z');
    expect(resolveUserLocalReferenceDate(instant, 'UTC')).toEqual(new Date('2026-08-13T00:00:00Z'));
  });

  it('rolls forward to the next calendar date for a positive UTC offset near midnight', () => {
    // 23:30 UTC on the 13th is already 08:30 on the 14th in Asia/Tokyo (UTC+9).
    const instant = new Date('2026-08-13T23:30:00Z');
    expect(resolveUserLocalReferenceDate(instant, 'Asia/Tokyo')).toEqual(
      new Date('2026-08-14T00:00:00Z'),
    );
  });

  it('stays on the prior calendar date for a negative UTC offset near midnight', () => {
    // `Etc/GMT+5` is a fixed-offset UTC-5 zone (note: POSIX/IANA's Etc/GMT
    // naming inverts the sign — "+5" means 5 hours *behind* UTC), chosen
    // over a real US timezone specifically so the offset is deterministic
    // year-round and this test never depends on DST rules.
    // 02:30 UTC on the 14th is still 21:30 on the 13th at UTC-5.
    const instant = new Date('2026-08-14T02:30:00Z');
    expect(resolveUserLocalReferenceDate(instant, 'Etc/GMT+5')).toEqual(
      new Date('2026-08-13T00:00:00Z'),
    );
  });

  it('handles a positive fixed UTC offset (UTC+5, e.g. Asia/Tashkent)', () => {
    // 20:00 UTC on the 13th is already 01:00 on the 14th at UTC+5.
    const instant = new Date('2026-08-13T20:00:00Z');
    expect(resolveUserLocalReferenceDate(instant, 'Asia/Tashkent')).toEqual(
      new Date('2026-08-14T00:00:00Z'),
    );
  });

  it('handles a negative fixed UTC offset (UTC-5)', () => {
    // 03:00 UTC on the 14th is still 22:00 on the 13th at UTC-5.
    const instant = new Date('2026-08-14T03:00:00Z');
    expect(resolveUserLocalReferenceDate(instant, 'Etc/GMT+5')).toEqual(
      new Date('2026-08-13T00:00:00Z'),
    );
  });

  it('resolves a positive UTC+9 offset consistently at a non-boundary instant', () => {
    const instant = new Date('2026-08-13T10:00:00Z'); // 19:00 local in Asia/Tokyo — same calendar date
    expect(resolveUserLocalReferenceDate(instant, 'Asia/Tokyo')).toEqual(
      new Date('2026-08-13T00:00:00Z'),
    );
  });

  it('falls back to the instant’s own UTC calendar date for an invalid/garbage timezone', () => {
    const instant = new Date('2026-08-13T12:00:00Z');
    expect(resolveUserLocalReferenceDate(instant, 'Not/A_Real_Zone')).toEqual(instant);
  });

  it('falls back to the instant’s own UTC calendar date for an empty timezone', () => {
    const instant = new Date('2026-08-13T12:00:00Z');
    expect(resolveUserLocalReferenceDate(instant, '')).toEqual(instant);
  });
});
