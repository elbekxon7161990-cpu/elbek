import { Global, Module } from '@nestjs/common';
import { DOMAIN_EVENT_CONSUMER_REGISTRY, type DomainEventConsumer } from '@afa/domain';

import { ReportCacheRepositoryModule } from '../cache/report-cache-repository.module';
import { NotificationDedupRepositoryModule } from '../repositories/notification-dedup-repository.module';
import { NotificationPreferenceRepositoryModule } from '../repositories/notification-preference-repository.module';
import { NotificationRepositoryModule } from '../repositories/notification-repository.module';
import { UserRepositoryModule } from '../repositories/user-repository.module';
import {
  DOMAIN_EVENT_CONSUMERS,
  MapDomainEventConsumerRegistry,
} from './map-domain-event-consumer-registry';
import {
  buildNotificationDeliveryConsumers,
  NotificationDeliveryConsumer,
} from './notification-delivery.consumer';
import { NotificationDeliveryQueueRepositoryModule } from '../queue/notification-delivery-queue-repository.module';
import {
  buildTransactionEventCacheInvalidationConsumers,
  TransactionEventCacheInvalidationConsumer,
} from './transaction-event-cache-invalidation.consumer';

/**
 * Binds @afa/domain's DOMAIN_EVENT_CONSUMER_REGISTRY port to
 * `MapDomainEventConsumerRegistry`. `@Global()` — see
 * user-repository.module.ts's TASK-MVP-002 comment for why a sibling import
 * under a shared parent module is not sufficient.
 *
 * TASK-DB-009 — `DOMAIN_EVENT_CONSUMERS` now resolves to the three real
 * cache-invalidation consumers (`TransactionCommitted`/`TransactionEdited`/
 * `TransactionDeleted`), replacing FR-DB-015's original empty-array binding.
 * This is the only change needed to give the dispatcher a real consumer —
 * `DomainEventDispatchProcessor`/`DispatchDomainEventsUseCase`/the claiming
 * mechanism (FR-DB-015) are untouched. A future task adding a consumer for
 * one of the other nine catalogued event types extends this same factory
 * (or replaces it with a `multi: true` provider set, if/when more than one
 * module needs to contribute consumers) — it does not touch the dispatcher
 * either.
 */
@Global()
@Module({
  imports: [
    ReportCacheRepositoryModule,
    UserRepositoryModule,
    NotificationPreferenceRepositoryModule,
    NotificationDedupRepositoryModule,
    NotificationRepositoryModule,
    NotificationDeliveryQueueRepositoryModule,
  ],
  providers: [
    TransactionEventCacheInvalidationConsumer,
    NotificationDeliveryConsumer,
    {
      provide: DOMAIN_EVENT_CONSUMERS,
      useFactory: (
        transactionHandler: TransactionEventCacheInvalidationConsumer,
        notificationHandler: NotificationDeliveryConsumer,
      ): DomainEventConsumer[] => [
        ...buildTransactionEventCacheInvalidationConsumers(transactionHandler),
        ...buildNotificationDeliveryConsumers(notificationHandler),
      ],
      inject: [TransactionEventCacheInvalidationConsumer, NotificationDeliveryConsumer],
    },
    { provide: DOMAIN_EVENT_CONSUMER_REGISTRY, useClass: MapDomainEventConsumerRegistry },
  ],
  exports: [DOMAIN_EVENT_CONSUMER_REGISTRY],
})
export class DomainEventConsumerRegistryModule {}
