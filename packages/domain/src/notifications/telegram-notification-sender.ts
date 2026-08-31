import type { TelegramInlineKeyboard } from './telegram-inline-keyboard';

export const TELEGRAM_NOTIFICATION_SENDER = Symbol('TELEGRAM_NOTIFICATION_SENDER');

/**
 * TASK-BOT-009 (§10.6.2's "Bot -> User" step, §10.6.8's single-channel
 * scope statement — Telegram only, no email/SMS fallback). Deliberately
 * narrow: send-only, no formatting/templating knowledge of its own (the
 * message text is already fully rendered by the time it reaches this
 * port — `render-debt-notification-message.ts`) and no awareness of
 * preferences/dedup/quiet-hours (all upstream concerns, `NotificationDeliveryConsumer`'s
 * own job). This is intentionally the smallest possible boundary between
 * "a notification decided it should be delivered" and "an actual Telegram
 * API call happened."
 *
 * Implementations must throw `TelegramDeliveryBlockedError` (`@afa/domain`)
 * specifically for a bot-blocked recipient (BR-NOT-001) and a plain `Error`
 * for any other failure (network error, rate limit, etc.) — the caller
 * relies on this distinction to decide whether to let BullMQ's own retry
 * policy re-attempt or to terminally suppress.
 */
export interface TelegramNotificationSender {
  /**
   * `replyMarkup` (TASK-AI-006) is additive and optional — every existing
   * call site omits it and behaves exactly as before.
   */
  send(chatId: string, message: string, replyMarkup?: TelegramInlineKeyboard): Promise<void>;
}
