/**
 * Plain interface, not a class-validator DTO — this is called directly by
 * apps/telegram-bot's transport layer (Telegraf ctx.from), never through an
 * HTTP controller's ValidationPipe, so decorators here would be dead weight.
 */
export interface ProvisionTelegramUserInput {
  telegramUserId: bigint;
  telegramUsername?: string;
  firstName?: string;
  lastName?: string;
  /** BCP-47 (Telegram's `language_code`), e.g. "en", "ru-RU". */
  languageCode?: string;
}
