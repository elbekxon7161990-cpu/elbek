import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
  accountDeletionGracePeriodDaysRemaining,
  isAccountDeletionGracePeriodExpired,
} from './account-deletion-grace-period';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('isAccountDeletionGracePeriodExpired (TASK-AUTH-006, FR-RET-001)', () => {
  it('is not expired one millisecond before the 30-day boundary', () => {
    const requestedAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(requestedAt.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_DAYS * DAY_MS - 1);
    expect(isAccountDeletionGracePeriodExpired(requestedAt, now)).toBe(false);
  });

  it('is expired at exactly the 30-day boundary (inclusive)', () => {
    const requestedAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(requestedAt.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_DAYS * DAY_MS);
    expect(isAccountDeletionGracePeriodExpired(requestedAt, now)).toBe(true);
  });

  it('is expired well after the boundary', () => {
    const requestedAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(requestedAt.getTime() + 45 * DAY_MS);
    expect(isAccountDeletionGracePeriodExpired(requestedAt, now)).toBe(true);
  });

  it('is not expired immediately after the request', () => {
    const requestedAt = new Date('2026-01-01T00:00:00.000Z');
    expect(isAccountDeletionGracePeriodExpired(requestedAt, requestedAt)).toBe(false);
  });
});

describe('accountDeletionGracePeriodDaysRemaining', () => {
  it('reports the full 30 days immediately after the request', () => {
    const requestedAt = new Date('2026-01-01T00:00:00.000Z');
    expect(accountDeletionGracePeriodDaysRemaining(requestedAt, requestedAt)).toBe(30);
  });

  it('rounds a partial day up rather than down', () => {
    const requestedAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(requestedAt.getTime() + 29 * DAY_MS + 1);
    expect(accountDeletionGracePeriodDaysRemaining(requestedAt, now)).toBe(1);
  });

  it('never reports a negative remainder once expired', () => {
    const requestedAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(requestedAt.getTime() + 45 * DAY_MS);
    expect(accountDeletionGracePeriodDaysRemaining(requestedAt, now)).toBe(0);
  });

  it('reports exactly 0 at the exact boundary', () => {
    const requestedAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(requestedAt.getTime() + 30 * DAY_MS);
    expect(accountDeletionGracePeriodDaysRemaining(requestedAt, now)).toBe(0);
  });
});
