/**
 * TASK-AUTH-006 (FR-RET-001 — 30-day recoverable grace period). Single
 * source of truth for the grace-period duration and its boundary math, so
 * `UserRepository.cancelDeletion`/`findExpiredPendingDeletions` (the
 * cancel-vs-purge mutual exclusion — see `PrismaUserRepository`'s own doc
 * comment) and the Telegram-facing "N days remaining" copy can never drift
 * apart. `deletionRequestedAt`/`now` are both `Timestamptz` instants, not
 * calendar dates, so this is deliberately plain millisecond arithmetic —
 * NOT `calendar-date.ts` (TASK-FIN-010's own DATE-typed, timezone-aware
 * domain, untouched by this task).
 */
export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 30;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_DELETION_GRACE_PERIOD_MS = ACCOUNT_DELETION_GRACE_PERIOD_DAYS * ONE_DAY_MS;

/** The cutoff instant: any `deletionRequestedAt <= cutoff` has an expired grace period as of `now`. */
export function accountDeletionCutoff(now: Date): Date {
  return new Date(now.getTime() - ACCOUNT_DELETION_GRACE_PERIOD_MS);
}

/** Inclusive at the exact 30-day boundary — expired at exactly `deletionRequestedAt + 30d`. */
export function isAccountDeletionGracePeriodExpired(deletionRequestedAt: Date, now: Date): boolean {
  return deletionRequestedAt.getTime() <= accountDeletionCutoff(now).getTime();
}

/** For user-facing "N days remaining" copy — never negative, rounds up so "less than a day left" still reads as 1, not 0. */
export function accountDeletionGracePeriodDaysRemaining(
  deletionRequestedAt: Date,
  now: Date,
): number {
  const expiresAt = deletionRequestedAt.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_MS;
  const remainingMs = expiresAt - now.getTime();
  return Math.max(0, Math.ceil(remainingMs / ONE_DAY_MS));
}
