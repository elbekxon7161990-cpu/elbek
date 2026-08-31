import { Global, Module } from '@nestjs/common';
import { NOTIFICATION_DELIVERY_QUEUE } from '@afa/domain';

import { BullMqNotificationDeliveryQueue } from './bullmq-notification-delivery.queue';
import { NotificationDeliveryQueueModule } from './notification-delivery.queue.module';

/** Binds @afa/domain's NOTIFICATION_DELIVERY_QUEUE port to the BullMQ implementation. `@Global()` — same pattern as `voice-transcription-queue-repository.module.ts`. */
@Global()
@Module({
  imports: [NotificationDeliveryQueueModule],
  providers: [{ provide: NOTIFICATION_DELIVERY_QUEUE, useClass: BullMqNotificationDeliveryQueue }],
  exports: [NOTIFICATION_DELIVERY_QUEUE],
})
export class NotificationDeliveryQueueRepositoryModule {}
