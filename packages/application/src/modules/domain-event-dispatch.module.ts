import { Module } from '@nestjs/common';

import { DispatchDomainEventsUseCase } from '../use-cases/dispatch-domain-events.use-case';

/**
 * FR-DB-015 — does not bind `DOMAIN_EVENT_REPOSITORY`, `DOMAIN_EVENT_CONSUMER_REGISTRY`,
 * or `DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS`; binding domain ports/config values
 * to real implementations is the composition root's job, the same split as
 * every other module in this package (`AiExtractionModule`, `FinanceModule`).
 */
@Module({
  providers: [DispatchDomainEventsUseCase],
  exports: [DispatchDomainEventsUseCase],
})
export class DomainEventDispatchModule {}
