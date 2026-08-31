import { Injectable, Logger } from '@nestjs/common';
import type { TelegramNotificationSender } from '@afa/domain';

/**
 * TASK-BOT-009 — bound in place of `TelegrafNotificationSender` when
 * `TELEGRAM_BOT_TOKEN` is not configured in this environment (mirrors
 * `EnvironmentBlockedProvidersModule`'s established pattern for a real
 * adapter that cannot run without a credential this specific deployment
 * doesn't have). Deliberately throws rather than silently succeeding — a
 * silent no-op would let `NotificationDeliveryProcessor` mark the
 * notification `sent` when nothing was actually delivered, a fabricated
 * result this class must never produce; throwing lets BullMQ's own
 * retry/backoff and eventual dead-letter behavior (BR-SYS-004) apply
 * exactly as it would to any other real delivery failure.
 */
@Injectable()
export class NullNotificationSender implements TelegramNotificationSender {
  private readonly logger = new Logger(NullNotificationSender.name);

  async send(): Promise<void> {
    this.logger.warn(
      'NullNotificationSender is active: TELEGRAM_BOT_TOKEN is not configured in this environment. No real notification was sent.',
    );
    throw new Error(
      'Telegram notification delivery is not configured (missing TELEGRAM_BOT_TOKEN).',
    );
  }
}
