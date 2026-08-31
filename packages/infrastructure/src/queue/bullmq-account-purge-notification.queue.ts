import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { AccountPurgeNotificationQueue } from '@afa/domain';
import type { Queue } from 'bullmq';

import { ACCOUNT_PURGE_NOTIFICATION_QUEUE_NAME } from './account-purge-notification.queue.module';

/** The BullMQ job payload — the recipient's Telegram chat id and language, carried directly (see `AccountPurgeNotificationQueue`'s own doc comment for why: there is no Postgres row left to re-read them from). */
export interface AccountPurgeNotificationJobPayload {
  telegramUserId: string;
  preferredLanguage: string;
}

@Injectable()
export class BullMqAccountPurgeNotificationQueue implements AccountPurgeNotificationQueue {
  constructor(
    @InjectQueue(ACCOUNT_PURGE_NOTIFICATION_QUEUE_NAME)
    private readonly queue: Queue<AccountPurgeNotificationJobPayload>,
  ) {}

  async enqueue(telegramUserId: string, preferredLanguage: string): Promise<void> {
    await this.queue.add(
      ACCOUNT_PURGE_NOTIFICATION_QUEUE_NAME,
      { telegramUserId, preferredLanguage },
      { jobId: `account-purge-notify-${telegramUserId}` },
    );
  }
}
