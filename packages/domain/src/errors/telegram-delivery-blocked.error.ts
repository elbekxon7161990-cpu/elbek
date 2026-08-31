/**
 * BR-NOT-001 — "after detecting a bot-blocked state, all non-critical
 * notification sends for that user are suspended until the user
 * re-engages." Thrown by a `TelegramNotificationSender` implementation
 * specifically when Telegram's own API reports the user has blocked the
 * bot (HTTP 403 "bot was blocked by the user") — a distinct, catchable
 * signal so the caller (`NotificationDeliveryProcessor`) can mark the
 * delivery terminally `failed` without retrying, rather than treating it
 * as an ordinary transient send failure BullMQ's own retry/backoff would
 * otherwise keep re-attempting indefinitely.
 */
export class TelegramDeliveryBlockedError extends Error {
  constructor(chatId: string) {
    super(`Telegram delivery to chat "${chatId}" was blocked by the recipient.`);
    this.name = 'TelegramDeliveryBlockedError';
  }
}
