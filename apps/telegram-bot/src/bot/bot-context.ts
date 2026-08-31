import type { User } from '@afa/domain';
import type { Context } from 'telegraf';

/**
 * Extends Telegraf's Context so the provisioning middleware (registered in
 * TelegramBotService, TASK-AUTH-001) can hand its result to downstream
 * handlers (e.g. /start, and TASK-BOT-001's message/callback routing)
 * without a second DB round-trip.
 */
export interface BotContext extends Context {
  provisioning?: {
    isNewUser: boolean;
    user: User;
  };
}
