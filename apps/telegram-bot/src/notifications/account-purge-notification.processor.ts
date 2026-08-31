import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  TELEGRAM_NOTIFICATION_SENDER,
  TelegramDeliveryBlockedError,
  resolveReplyLanguage,
  toDetectedLanguage,
  type TelegramNotificationSender,
} from '@afa/domain';
import type { AccountPurgeNotificationJobPayload } from '@afa/infrastructure';
import { ACCOUNT_PURGE_NOTIFICATION_QUEUE_NAME } from '@afa/infrastructure';
import type { Job } from 'bullmq';

import { accountPurgeCompletedReply } from '../bot/reply-messages';

/**
 * TASK-AUTH-006 (FR-RET-002 — the final, irreversible-completion
 * confirmation, "sent only after a verified-successful purge"). Lives here,
 * in `apps/telegram-bot`, for exactly the reason `NotificationDeliveryProcessor`'s
 * own doc comment already establishes: this is the one process holding the
 * real Telegraf/Bot-API relationship. Deliberately simpler than that
 * processor — there is no `notifications`/`users` row left to re-read
 * (both are gone by the time this job is enqueued), so the job payload IS
 * the full, authoritative content; nothing here runs under
 * `runWithUserContext` either, since there is no RLS-protected row left to
 * query for this user at all.
 */
@Processor(ACCOUNT_PURGE_NOTIFICATION_QUEUE_NAME)
@Injectable()
export class AccountPurgeNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountPurgeNotificationProcessor.name);

  constructor(
    @Inject(TELEGRAM_NOTIFICATION_SENDER)
    private readonly telegramSender: TelegramNotificationSender,
  ) {
    super();
  }

  async process(job: Job<AccountPurgeNotificationJobPayload>): Promise<{ status: string }> {
    const { telegramUserId, preferredLanguage } = job.data;
    const language = resolveReplyLanguage(toDetectedLanguage(preferredLanguage), null);

    try {
      await this.telegramSender.send(telegramUserId, accountPurgeCompletedReply(language));
    } catch (error) {
      if (error instanceof TelegramDeliveryBlockedError) {
        // BR-NOT-001 — never retry a blocked recipient; there is no
        // Notification row to mark failed here (there is nothing left in
        // Postgres for this user at all), so this is simply a terminal,
        // logged no-op.
        this.logger.warn('Account-purge completion message: recipient has blocked the bot.');
        return { status: 'blocked' };
      }
      throw error;
    }

    return { status: 'sent' };
  }
}
