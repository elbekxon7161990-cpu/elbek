/**
 * TASK-BOT-004 (Chapter 5 §5.5, FR-CE-021) — "Drafts older than 7 days with
 * no user interaction must trigger a single reminder notification ... then
 * auto-expire ... after 30 days of total inactivity." Both windows are
 * measured from `lastInteractionAt`, not `createdAt` — "total inactivity"
 * means the clock resets on any interaction, not just creation.
 *
 * Deliberately the same lazy, read-time-expiry pattern as
 * `isConversationStateExpired` (§5.19.2): "any state read as expired ...
 * independent of whether a background expiry job actually ran." No
 * scheduler/cron infrastructure exists anywhere in this repository
 * (verified by repo-wide search before writing this file) — this task does
 * not introduce one. FR-CE-021's *30-day auto-expire* half is therefore
 * fully implemented as this pure, boundary-exact predicate, applied by
 * every read path that lists a user's drafts (`/drafts`, TASK-BOT-004's
 * `ListDraftsUseCase`) — an expired draft is excluded from the list exactly
 * as if it had been soft-deleted, with no separate write ever required to
 * make that true. The *7-day proactive reminder* half is a push
 * notification sent unprompted by any user action, which cannot be
 * expressed as a read-time predicate alone — see `isDraftDueForReminder`'s
 * own doc comment for why only the pure predicate is implemented here and
 * the actual delivery mechanism is explicitly deferred, not built.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DRAFT_REMINDER_THRESHOLD_DAYS = 7;
export const DRAFT_EXPIRY_THRESHOLD_DAYS = 30;

/** The exact instant a draft last interacted with at `lastInteractionAt` becomes expired. */
export function computeDraftExpiresAt(lastInteractionAt: Date): Date {
  return new Date(lastInteractionAt.getTime() + DRAFT_EXPIRY_THRESHOLD_DAYS * MS_PER_DAY);
}

/**
 * `<=`, not `<` — the same boundary convention `isConversationStateExpired`
 * already established: a draft is considered expired *at* its computed
 * expiry instant, not only strictly after it. Verified by this module's own
 * spec at exactly T-1ms / T / T+1ms around the boundary.
 */
export function isDraftExpired(lastInteractionAt: Date, now: Date): boolean {
  return computeDraftExpiresAt(lastInteractionAt).getTime() <= now.getTime();
}

/** The exact instant a draft last interacted with at `lastInteractionAt` becomes due for FR-CE-021's single 7-day reminder. */
export function computeDraftReminderDueAt(lastInteractionAt: Date): Date {
  return new Date(lastInteractionAt.getTime() + DRAFT_REMINDER_THRESHOLD_DAYS * MS_PER_DAY);
}

/**
 * Pure predicate only — deliberately NOT wired to any delivery mechanism.
 * FR-CE-021's reminder is a proactive push ("You have an unfinished entry
 * from last week...") that must be sent once, unprompted, when a background
 * sweep observes a draft crossing this boundary — that requires a
 * scheduler/cron worker to periodically call this predicate against every
 * pending draft and a "reminder already sent" flag to guarantee the
 * "single" in FR-CE-021, neither of which exists in this codebase today.
 * Building either is an unrelated architecture addition this task's own
 * instructions forbid inventing ("Do NOT invent a large scheduling
 * subsystem"). This function is deliberately left available, tested, and
 * ready for whichever future task adds the scheduler to call it against —
 * see the final report's explicit gap note.
 */
export function isDraftDueForReminder(lastInteractionAt: Date, now: Date): boolean {
  return computeDraftReminderDueAt(lastInteractionAt).getTime() <= now.getTime();
}
