import {
  ADMIN_LOCKOUT_FAILURE_THRESHOLD,
  ADMIN_LOCKOUT_WINDOW_MS,
  backoffDurationMsForCycle,
} from './admin-lockout-constants';

export interface AdminLockoutState {
  failedLoginAttempts: number;
  failedLoginWindowStartedAt: Date | null;
  lockedUntil: Date | null;
  lockoutCycleCount: number;
}

export interface AdminLockoutOutcome extends AdminLockoutState {
  /** True only on the transition from not-locked to locked this call caused. */
  justLocked: boolean;
}

/**
 * TASK-AUTH-002 — pure lockout-policy decision (NFR-AUTH-004), unit-testable
 * without any database, kept out of the Prisma repository per BR-SYS-002
 * (business-rule-bearing conditionals confined to domain/application, never
 * scattered into infrastructure SQL). The caller (an application use case)
 * is responsible for the atomic conditional write applying whichever
 * outcome this returns — see PrismaAdminRepository.applyFailedLoginOutcome's
 * own doc comment for the concurrency guarantee.
 */
export function isAdminCurrentlyLocked(state: AdminLockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * Computes the next lockout state after one authentication failure
 * (password step or MFA step — 7.1.9 explicitly counts both toward the same
 * threshold). Never increments while already locked (explicit instruction:
 * a failed attempt against an already-locked account must not extend or
 * otherwise alter the lockout).
 */
export function computeAdminLockoutOutcome(
  state: AdminLockoutState,
  now: Date,
): AdminLockoutOutcome {
  if (isAdminCurrentlyLocked(state, now)) {
    return { ...state, justLocked: false };
  }

  const windowExpired =
    state.failedLoginWindowStartedAt === null ||
    now.getTime() - state.failedLoginWindowStartedAt.getTime() > ADMIN_LOCKOUT_WINDOW_MS;

  const nextAttempts = windowExpired ? 1 : state.failedLoginAttempts + 1;
  const nextWindowStartedAt = windowExpired ? now : state.failedLoginWindowStartedAt;

  if (nextAttempts >= ADMIN_LOCKOUT_FAILURE_THRESHOLD) {
    const nextCycle = state.lockoutCycleCount + 1;
    return {
      failedLoginAttempts: 0,
      failedLoginWindowStartedAt: null,
      lockedUntil: new Date(now.getTime() + backoffDurationMsForCycle(nextCycle)),
      lockoutCycleCount: nextCycle,
      justLocked: true,
    };
  }

  return {
    failedLoginAttempts: nextAttempts,
    failedLoginWindowStartedAt: nextWindowStartedAt,
    lockedUntil: null,
    lockoutCycleCount: state.lockoutCycleCount,
    justLocked: false,
  };
}

/** A fully successful (password + MFA) authentication resets every counter. */
export function resetAdminLockoutState(): AdminLockoutState {
  return {
    failedLoginAttempts: 0,
    failedLoginWindowStartedAt: null,
    lockedUntil: null,
    lockoutCycleCount: 0,
  };
}
