export const NOTIFICATION_PREFERENCE_REPOSITORY = Symbol('NOTIFICATION_PREFERENCE_REPOSITORY');

/**
 * TASK-BOT-009 (FR-NOT-001) — reads per-category notification toggles from
 * `user_settings` (§13.9's extensible key-value table). There is no
 * `/settings` UI anywhere in this codebase yet to ever *write* an override
 * (no task owns building one — see this task's final report), so today
 * `isEnabled` always returns the documented default (`true`, "all enabled"
 * per §7.4.4/§7.9.4) for every real call — this is the correct, honest
 * behavior given the actual current state, not a stub: the read path
 * itself is real and will pick up a real override the moment one exists,
 * requiring no future change to this port or its consumers.
 */
export interface NotificationPreferenceRepository {
  isEnabled(userId: string, preferenceKey: string): Promise<boolean>;
}
