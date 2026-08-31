import { describe, expect, it } from 'vitest';

import { normalizeTransactionTime } from './normalize-transaction-time';

describe('normalizeTransactionTime', () => {
  it('fills in :00 seconds for a valid HH:MM time', () => {
    expect(normalizeTransactionTime('14:32')).toBe('14:32:00');
  });

  it('fills in :00 seconds for a valid HH:MM time with a leading zero hour', () => {
    expect(normalizeTransactionTime('09:05')).toBe('09:05:00');
  });

  it('leaves an already-valid HH:MM:SS time unchanged', () => {
    expect(normalizeTransactionTime('14:32:59')).toBe('14:32:59');
  });

  it('leaves the boundary time 23:59:59 unchanged', () => {
    expect(normalizeTransactionTime('23:59:59')).toBe('23:59:59');
  });

  it('rejects an invalid hour', () => {
    expect(normalizeTransactionTime('24:00')).toBeNull();
    expect(normalizeTransactionTime('24:00:00')).toBeNull();
  });

  it('rejects an invalid minute', () => {
    expect(normalizeTransactionTime('12:60')).toBeNull();
    expect(normalizeTransactionTime('12:60:00')).toBeNull();
  });

  it('rejects a malformed string', () => {
    expect(normalizeTransactionTime('not-a-time')).toBeNull();
    expect(normalizeTransactionTime('2:5')).toBeNull();
    expect(normalizeTransactionTime('14:32:00:00')).toBeNull();
    expect(normalizeTransactionTime('')).toBeNull();
  });

  it('is idempotent — normalizing an already-normalized value changes nothing', () => {
    const once = normalizeTransactionTime('14:32');
    expect(once).not.toBeNull();
    const twice = normalizeTransactionTime(once as string);
    expect(twice).toBe(once);
  });
});
