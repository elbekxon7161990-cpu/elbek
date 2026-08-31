import { Module } from '@nestjs/common';
import { AppConfigModule, AppLoggerModule } from '@afa/shared';
import { PrismaModule, QueueModule, RedisModule } from '@afa/infrastructure';

import { TelegramBotModule } from './bot/telegram-bot.module';

/**
 * TASK-BOT-001 adds `RedisModule` (conversation state CAS + the webhook
 * update-dedup service) and `QueueModule.forRoot()` (this app enqueues
 * STT/OCR jobs — "the Worker must execute queues only", this app was a
 * producer only, never a consumer/processor, until TASK-BOT-009) to what
 * TASK-AUTH-001 already loaded (config, logging, Prisma).
 *
 * TASK-BOT-009 — this app now ALSO consumes exactly one queue
 * (`notification-delivery`, via `NotificationDeliveryModule`,
 * `apps/telegram-bot/src/notifications/`) — a deliberate, disclosed
 * exception to the "producer only" rule above: this app already owns the
 * real Telegraf/Bot-API relationship, and the PRD's own architecture
 * (§10.6.1) names it as the actual delivery mechanism, unlike STT/OCR
 * jobs, which are genuinely `apps/worker`'s own Worker Pool concern. See
 * `NotificationDeliveryProcessor`'s own doc comment for the full reasoning.
 */
@Module({
  imports: [
    AppConfigModule.forRoot(),
    AppLoggerModule.forRoot('afa-telegram-bot'),
    PrismaModule,
    RedisModule,
    QueueModule.forRoot(),
    TelegramBotModule,
  ],
})
export class AppModule {}
