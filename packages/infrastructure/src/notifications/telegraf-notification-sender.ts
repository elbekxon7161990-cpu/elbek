import { Injectable } from '@nestjs/common';
import {
  TelegramDeliveryBlockedError,
  type TelegramInlineKeyboard,
  type TelegramNotificationSender,
} from '@afa/domain';
import { Telegram, TelegramError } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';

function toTelegrafMarkup(keyboard: TelegramInlineKeyboard): InlineKeyboardMarkup {
  return { inline_keyboard: keyboard as InlineKeyboardMarkup['inline_keyboard'] };
}

/**
 * TASK-BOT-009 (§10.6.2's "Bot -> User" step). Uses `telegraf`'s standalone
 * `Telegram` API client (send-only — no polling/webhook/update-handling
 * machinery, unlike the full `Telegraf` bot instance `apps/telegram-bot`
 * constructs) since sending a message requires only a bot token, never a
 * running update loop. This is a deliberate, separate client instance from
 * `apps/telegram-bot`'s own `Telegraf` — the two apps are different
 * processes with no shared in-memory state, and `telegraf` supports
 * constructing multiple independent API clients against the same token
 * with no conflict (Telegram's Bot API itself has no concept of "the one
 * true client" for a token; only the update-delivery mechanism, long-poll
 * vs. webhook, is exclusive, and this class never touches that).
 *
 * HTTP error code 403 ("Forbidden") covers both "bot was blocked by the
 * user" and a small number of other unreachable-recipient cases (e.g. the
 * user deactivated their account) — BR-NOT-001 only names the blocked
 * case explicitly, but treating 403 broadly as "this recipient cannot be
 * reached, do not keep retrying" is the same, correct response either way.
 */
@Injectable()
export class TelegrafNotificationSender implements TelegramNotificationSender {
  private readonly telegram: Telegram;

  constructor(botToken: string) {
    this.telegram = new Telegram(botToken);
  }

  async send(chatId: string, message: string, replyMarkup?: TelegramInlineKeyboard): Promise<void> {
    try {
      await this.telegram.sendMessage(
        chatId,
        message,
        replyMarkup ? { reply_markup: toTelegrafMarkup(replyMarkup) } : undefined,
      );
    } catch (error) {
      if (error instanceof TelegramError && error.response.error_code === 403) {
        throw new TelegramDeliveryBlockedError(chatId);
      }
      throw error;
    }
  }
}
