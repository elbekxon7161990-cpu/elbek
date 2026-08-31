import { Global, Module } from '@nestjs/common';
import { ACCOUNT_PURGE_NOTIFICATION_QUEUE } from '@afa/domain';

import { AccountPurgeNotificationQueueModule } from './account-purge-notification.queue.module';
import { BullMqAccountPurgeNotificationQueue } from './bullmq-account-purge-notification.queue';

/** Binds @afa/domain's ACCOUNT_PURGE_NOTIFICATION_QUEUE port to the BullMQ implementation. `@Global()` — same pattern as `notification-delivery-queue-repository.module.ts`. */
@Global()
@Module({
  imports: [AccountPurgeNotificationQueueModule],
  providers: [
    { provide: ACCOUNT_PURGE_NOTIFICATION_QUEUE, useClass: BullMqAccountPurgeNotificationQueue },
  ],
  exports: [ACCOUNT_PURGE_NOTIFICATION_QUEUE],
})
export class AccountPurgeNotificationQueueRepositoryModule {}
