export const ACCOUNT_PURGE_NOTIFICATION_QUEUE = Symbol('ACCOUNT_PURGE_NOTIFICATION_QUEUE');

/**
 * TASK-AUTH-006 — the final, irreversible-completion confirmation
 * (§12.18), sent only after a verified-successful purge. Cannot reuse the
 * existing `NotificationDeliveryQueue`/`notifications`-table pipeline
 * (`NotificationDeliveryProcessor`'s own doc comment): that pipeline
 * resolves the recipient by re-reading `userId` -> `users` ->
 * `telegramUserId`, and both the `users` row and any `notifications` row
 * for this user are gone by the time this fires. Mirrors that same
 * processor's own disclosed, considered exception instead — one new,
 * narrowly-scoped queue, carrying the Telegram chat id and language
 * directly (there is nothing left in Postgres to re-read them from),
 * produced by `apps/worker`'s purge job, consumed by `apps/telegram-bot`
 * (the only process holding the real Telegraf/Bot-API relationship).
 */
export interface AccountPurgeNotificationQueue {
  enqueue(telegramUserId: string, preferredLanguage: string): Promise<void>;
}
