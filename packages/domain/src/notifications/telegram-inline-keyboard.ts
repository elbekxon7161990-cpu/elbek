/**
 * TASK-AI-006 (OCR draft review delivery) — the minimal, vendor-neutral
 * shape needed to carry an inline keyboard through `NotificationRepository`/
 * `TelegramNotificationSender`. Deliberately NOT `telegraf`'s own
 * `InlineKeyboardMarkup` type — `@afa/domain` never depends on a vendor SDK
 * (same rule every other port in this package already follows). The
 * Telegram-layer adapter (`TelegrafNotificationSender`) is responsible for
 * converting this into whatever shape `telegraf`'s `sendMessage` expects.
 */
export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export type TelegramInlineKeyboard = readonly (readonly TelegramInlineKeyboardButton[])[];
