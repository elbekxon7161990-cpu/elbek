import { describe, expect, it } from 'vitest';

import type { SearchSessionRecord } from '../entities/search-session.entity';
import { isSearchSessionExpired } from './is-search-session-expired';

function record(overrides: Partial<SearchSessionRecord> = {}): SearchSessionRecord {
  return {
    version: 1,
    filters: {},
    awaitingField: null,
    page: 0,
    expiresAt: '2026-01-01T00:10:00Z',
    ...overrides,
  };
}

describe('isSearchSessionExpired', () => {
  it('returns false when now is before expiresAt', () => {
    expect(isSearchSessionExpired(record(), '2026-01-01T00:05:00Z')).toBe(false);
  });

  it('returns true when now is exactly expiresAt (boundary, inclusive)', () => {
    expect(isSearchSessionExpired(record(), '2026-01-01T00:10:00Z')).toBe(true);
  });

  it('returns true when now is after expiresAt', () => {
    expect(isSearchSessionExpired(record(), '2026-01-01T00:15:00Z')).toBe(true);
  });
});
