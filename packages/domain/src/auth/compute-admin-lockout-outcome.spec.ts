import { describe, expect, it } from 'vitest';

import {
  computeAdminLockoutOutcome,
  isAdminCurrentlyLocked,
  resetAdminLockoutState,
  type AdminLockoutState,
} from './compute-admin-lockout-outcome';

const NOW = new Date('2026-08-23T10:00:00.000Z');

function stateAfter(minutesAgo: number, attempts: number): AdminLockoutState {
  return {
    failedLoginAttempts: attempts,
    failedLoginWindowStartedAt: new Date(NOW.getTime() - minutesAgo * 60 * 1000),
    lockedUntil: null,
    lockoutCycleCount: 0,
  };
}

describe('computeAdminLockoutOutcome', () => {
  it('increments within the window without locking below the threshold', () => {
    const outcome = computeAdminLockoutOutcome(stateAfter(2, 1), NOW);
    expect(outcome).toEqual({
      failedLoginAttempts: 2,
      failedLoginWindowStartedAt: new Date(NOW.getTime() - 2 * 60 * 1000),
      lockedUntil: null,
      lockoutCycleCount: 0,
      justLocked: false,
    });
  });

  it('starts a fresh window on the very first failure', () => {
    const state: AdminLockoutState = {
      failedLoginAttempts: 0,
      failedLoginWindowStartedAt: null,
      lockedUntil: null,
      lockoutCycleCount: 0,
    };
    const outcome = computeAdminLockoutOutcome(state, NOW);
    expect(outcome.failedLoginAttempts).toBe(1);
    expect(outcome.failedLoginWindowStartedAt).toEqual(NOW);
    expect(outcome.justLocked).toBe(false);
  });

  it('resets the window if the prior window is older than 15 minutes, rather than accumulating across it', () => {
    const outcome = computeAdminLockoutOutcome(stateAfter(20, 4), NOW);
    expect(outcome.failedLoginAttempts).toBe(1);
    expect(outcome.failedLoginWindowStartedAt).toEqual(NOW);
    expect(outcome.justLocked).toBe(false);
  });

  it('locks on the 5th consecutive failure within the window, 1-minute first-cycle backoff', () => {
    const outcome = computeAdminLockoutOutcome(stateAfter(5, 4), NOW);
    expect(outcome.justLocked).toBe(true);
    expect(outcome.lockoutCycleCount).toBe(1);
    expect(outcome.lockedUntil).toEqual(new Date(NOW.getTime() + 1 * 60 * 1000));
    expect(outcome.failedLoginAttempts).toBe(0);
    expect(outcome.failedLoginWindowStartedAt).toBeNull();
  });

  it('does not increment or extend the lockout while already locked', () => {
    const state: AdminLockoutState = {
      failedLoginAttempts: 0,
      failedLoginWindowStartedAt: null,
      lockedUntil: new Date(NOW.getTime() + 30_000),
      lockoutCycleCount: 1,
    };
    const outcome = computeAdminLockoutOutcome(state, NOW);
    expect(outcome).toEqual({ ...state, justLocked: false });
  });

  it('applies the exponential schedule across repeated lockout cycles, capped at 15 minutes', () => {
    const durationsMinutes = [1, 2, 4, 8, 15, 15];
    let cycleCount = 0;
    for (const expectedMinutes of durationsMinutes) {
      // Simulate the cycle count already accumulated from prior lockouts.
      const state: AdminLockoutState = {
        failedLoginAttempts: 4,
        failedLoginWindowStartedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
        lockedUntil: null,
        lockoutCycleCount: cycleCount,
      };
      const result = computeAdminLockoutOutcome(state, NOW);
      expect(result.justLocked).toBe(true);
      expect(result.lockedUntil).toEqual(new Date(NOW.getTime() + expectedMinutes * 60 * 1000));
      cycleCount = result.lockoutCycleCount;
    }
  });

  it('isAdminCurrentlyLocked reports true only strictly before lockedUntil', () => {
    expect(
      isAdminCurrentlyLocked(
        {
          failedLoginAttempts: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: new Date(NOW.getTime() + 1),
          lockoutCycleCount: 1,
        },
        NOW,
      ),
    ).toBe(true);
    expect(
      isAdminCurrentlyLocked(
        {
          failedLoginAttempts: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: NOW,
          lockoutCycleCount: 1,
        },
        NOW,
      ),
    ).toBe(false);
    expect(
      isAdminCurrentlyLocked(
        {
          failedLoginAttempts: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
          lockoutCycleCount: 0,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it('resetAdminLockoutState zeroes every field', () => {
    expect(resetAdminLockoutState()).toEqual({
      failedLoginAttempts: 0,
      failedLoginWindowStartedAt: null,
      lockedUntil: null,
      lockoutCycleCount: 0,
    });
  });
});
