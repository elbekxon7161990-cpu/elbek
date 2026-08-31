import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS, DomainEventDispatchModule } from '@afa/application';
import {
  DomainEventConsumerRegistryModule,
  DomainEventDispatchQueueModule,
  DomainEventRepositoryModule,
} from '@afa/infrastructure';

import { DomainEventDispatchProcessor } from './domain-event-dispatch.processor';
import { DomainEventDispatchScheduler } from './domain-event-dispatch.scheduler';

/**
 * FR-DB-015 — composition-root wiring for the domain-event dispatch worker.
 *
 * `@Global()`, exporting `DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS`: this factory
 * provider is declared here (apps/worker), but the class that injects it —
 * `DispatchDomainEventsUseCase` — lives inside `@afa/application`'s own
 * `DomainEventDispatchModule`, a *different* Nest module/injector scope.
 * NestJS does not let an importing module's local providers reach "down"
 * into a module it imports; only `@Global()` (or an explicit export chain
 * running the other direction) makes a provider visible across that
 * boundary. This is the exact same cross-module-visibility problem
 * `PrismaModule`/`DomainEventRepositoryModule`/
 * `DomainEventConsumerRegistryModule` already solve the same way in this
 * codebase — not a new pattern.
 *
 * Unlike `SttModule`/`OcrModule` (both explicitly NOT yet imported into
 * `AppModule`, pending vendor provider bindings that don't exist), this
 * module IS imported into the real `AppModule` below — every port it needs
 * (`DOMAIN_EVENT_REPOSITORY`, `DOMAIN_EVENT_CONSUMER_REGISTRY`) already has a
 * real, fully bindable implementation, so the dispatcher genuinely runs.
 */
@Global()
@Module({
  imports: [
    DomainEventDispatchModule,
    DomainEventRepositoryModule,
    DomainEventConsumerRegistryModule,
    DomainEventDispatchQueueModule,
  ],
  providers: [
    {
      provide: DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS,
      useFactory: (config: ConfigService) =>
        config.get<number>('DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS', 5),
      inject: [ConfigService],
    },
    DomainEventDispatchProcessor,
    DomainEventDispatchScheduler,
  ],
  exports: [DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS],
})
export class DomainEventsModule {}
