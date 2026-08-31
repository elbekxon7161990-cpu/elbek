import { Global, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TELEGRAM_NOTIFICATION_SENDER } from '@afa/domain';
import {
  AccountPurgeNotificationQueueModule,
  NotificationDeliveryQueueModule,
  NotificationDeliveryQueueRepositoryModule,
  NotificationRepositoryModule,
  NullNotificationSender,
  TelegrafNotificationSender,
  UserRepositoryModule,
} from '@afa/infrastructure';

import { AccountPurgeNotificationProcessor } from './account-purge-notification.processor';
import { NotificationDeliveryProcessor } from './notification-delivery.processor';

/**
 * TASK-BOT-009 — composition-root wiring for the Telegram-delivery half of
 * notification delivery (`NotificationDeliveryProcessor`'s own doc comment
 * explains why this lives in `apps/telegram-bot`, not `apps/worker`).
 *
 * `TELEGRAM_NOTIFICATION_SENDER` binds the real `TelegrafNotificationSender`
 * when `TELEGRAM_BOT_TOKEN` is configured (it already is, for this app's
 * own bot instance), falling back to `NullNotificationSender` otherwise —
 * mirrors `EnvironmentBlockedProvidersModule`'s established pattern for a
 * real adapter this specific environment might not have credentials for.
 *
 * TASK-AUTH-006 — also registers `AccountPurgeNotificationProcessor`
 * (`AccountPurgeNotificationQueueModule` imported alongside
 * `NotificationDeliveryQueueModule` for the same reason), reusing this
 * exact `TELEGRAM_NOTIFICATION_SENDER` binding for the final
 * irreversible-completion message — the same real Telegraf relationship,
 * a different, narrower queue.
 *
 * TASK-AI-006 (OCR completion round) — also imports
 * `NotificationDeliveryQueueRepositoryModule` (binds the `NOTIFICATION_DELIVERY_QUEUE`
 * port, `@Global()`), needed because this app's own `BotApplicationModule`
 * imports `AiExtractionModule` (for text-message extraction) which bundles
 * `ProcessReceiptImageUseCase` alongside it — that use-case needs
 * `NOTIFICATION_DELIVERY_QUEUE` to resolve even though nothing in this app
 * ever calls it directly (only `apps/worker`'s `OcrExtractionProcessor`
 * does; this app only enqueues OCR *jobs*, via `OCR_EXTRACTION_QUEUE`,
 * a different port entirely). Safe to import alongside the existing raw
 * `NotificationDeliveryQueueModule` above — both register the same BullMQ
 * queue name, and NestJS module instances are singletons per class
 * regardless of how many parents import them.
 */
@Global()
@Module({
  imports: [
    UserRepositoryModule,
    NotificationRepositoryModule,
    NotificationDeliveryQueueModule,
    NotificationDeliveryQueueRepositoryModule,
    AccountPurgeNotificationQueueModule,
  ],
  providers: [
    {
      provide: TELEGRAM_NOTIFICATION_SENDER,
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('TELEGRAM_BOT_TOKEN');
        return token ? new TelegrafNotificationSender(token) : new NullNotificationSender();
      },
      inject: [ConfigService],
    },
    NotificationDeliveryProcessor,
    AccountPurgeNotificationProcessor,
  ],
  exports: [TELEGRAM_NOTIFICATION_SENDER],
})
export class NotificationDeliveryModule implements OnModuleInit {
  private readonly logger = new Logger(NotificationDeliveryModule.name);

  onModuleInit(): void {
    this.logger.log(
      'NotificationDeliveryModule active — consuming the notification-delivery queue.',
    );
  }
}
