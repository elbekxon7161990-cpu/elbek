export const USER_PREFERENCE_REPOSITORY = Symbol('USER_PREFERENCE_REPOSITORY');

/**
 * FR-SET-002 (notification toggles)/§7.4.4 (confidence-display preference)
 * — a small, generic boolean-preference port over the same `user_settings`
 * (§13.9) extensible key-value table `NotificationPreferenceRepository`
 * already reads. Deliberately separate from that port rather than adding a
 * write method to it: `NotificationPreferenceRepository` is TASK-BOT-009's
 * own read-only contract for the notification-delivery pipeline specifically
 * (its own doc comment frames it exactly that way), and this task must not
 * modify that already-real, already-tested pipeline's own interface. This
 * port's `setBoolean` writes the SAME `{ enabled: boolean }` JSON shape
 * `PrismaNotificationPreferenceRepository.isEnabled` already expects, so a
 * toggle made here is correctly picked up by that existing read path with
 * zero changes to it — verified in this task's own integration test.
 *
 * `getBoolean`'s `defaultValue` mirrors `isEnabled`'s own "no row means the
 * documented default" convention (§7.4.4/§7.9.4 — "all enabled" for
 * notifications; "Show" for confidence-display) — never inferred here, the
 * caller always states its own default explicitly.
 */
export interface UserPreferenceRepository {
  getBoolean(userId: string, key: string, defaultValue: boolean): Promise<boolean>;
  setBoolean(userId: string, key: string, value: boolean): Promise<void>;
}
