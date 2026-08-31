import type { AdminLockoutState, AdminRepository } from '@afa/domain';
import { computeAdminLockoutOutcome } from '@afa/domain';

const MAX_RETRIES = 3;

/**
 * TASK-AUTH-002 — shared by both login-step use cases (password-step and
 * MFA-step both count toward the same NFR-AUTH-004 threshold, per §7.1.9).
 * Retries a bounded number of times against
 * `AdminRepository.applyFailedLoginOutcome`'s optimistic-concurrency guard:
 * a lost race means the row changed between read and write, so the pure
 * decision is recomputed against the freshly-read state rather than ever
 * applying a decision made against state that's no longer current. Under
 * pathological, sustained concurrent-failure load against the very same
 * admin this can still (rarely) exhaust its retries without writing — an
 * accepted, bounded imperfection, never a thrown error surfaced to the
 * caller (a failed count-increment must never block returning the generic
 * "invalid credentials" response the caller was already going to give).
 */
export async function applyAdminLoginFailure(
  admins: AdminRepository,
  adminId: string,
  expected: AdminLockoutState,
  now: Date,
): Promise<void> {
  let currentExpected = expected;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const outcome = computeAdminLockoutOutcome(currentExpected, now);
    const result = await admins.applyFailedLoginOutcome(adminId, currentExpected, outcome);
    if (result) {
      return;
    }
    const fresh = await admins.findById(adminId);
    if (!fresh) {
      return;
    }
    currentExpected = {
      failedLoginAttempts: fresh.failedLoginAttempts,
      failedLoginWindowStartedAt: fresh.failedLoginWindowStartedAt,
      lockedUntil: fresh.lockedUntil,
      lockoutCycleCount: fresh.lockoutCycleCount,
    };
  }
}
