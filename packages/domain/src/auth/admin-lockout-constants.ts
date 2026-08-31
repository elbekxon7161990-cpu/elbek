/**
 * TASK-AUTH-002 (NFR-AUTH-004) — "Lock account after 5 consecutive failures
 * within 15 minutes, exponential backoff on retry." The PRD states the
 * threshold/window exactly but leaves the backoff schedule's concrete
 * numbers unspecified; the following schedule was explicitly authorized by
 * the user for this task (5-lockout-cycle schedule, capped at 15 minutes —
 * the same 15-minute figure NFR-AUTH-004 already uses for the failure
 * window, chosen as the cap so backoff never exceeds the window it grew out
 * of).
 */
export const ADMIN_LOCKOUT_FAILURE_THRESHOLD = 5;

export const ADMIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/** Index 0 = 1st lockout cycle, index 4+ = 5th and every subsequent cycle. */
export const ADMIN_LOCKOUT_BACKOFF_SCHEDULE_MS: readonly number[] = [
  1 * 60 * 1000,
  2 * 60 * 1000,
  4 * 60 * 1000,
  8 * 60 * 1000,
  15 * 60 * 1000,
];

export function backoffDurationMsForCycle(lockoutCycleCount: number): number {
  const index = Math.min(lockoutCycleCount - 1, ADMIN_LOCKOUT_BACKOFF_SCHEDULE_MS.length - 1);
  return ADMIN_LOCKOUT_BACKOFF_SCHEDULE_MS[Math.max(index, 0)];
}
