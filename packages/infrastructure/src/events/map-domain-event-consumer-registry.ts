import { Inject, Injectable } from '@nestjs/common';
import type {
  DomainEventConsumer,
  DomainEventConsumerRegistry,
  DomainEventType,
} from '@afa/domain';

/**
 * Multi-provider injection point for real `DomainEventConsumer`
 * implementations. Resolves to an empty array today (see
 * `domain-event-consumer-registry.module.ts`) — no real consumer exists yet
 * (TASK-DB-009/TASK-BOT-009, both explicitly out of FR-DB-015's scope). A
 * future consumer module adds itself here; this token is the seam it uses,
 * not a reason to edit this file.
 */
export const DOMAIN_EVENT_CONSUMERS = Symbol('DOMAIN_EVENT_CONSUMERS');

/**
 * The simplest possible `DomainEventConsumerRegistry`: a `Map` built once at
 * construction from whichever consumers DI provides. Two consumers
 * registered for the same `eventType` is not guarded against here — §8.22.2
 * models each event type as having exactly one designated consuming
 * chapter, so this is a "should not happen" condition (last-registered-wins
 * is `Map`'s own natural behavior), not one this task invents recovery
 * logic for.
 */
@Injectable()
export class MapDomainEventConsumerRegistry implements DomainEventConsumerRegistry {
  private readonly consumersByType: Map<DomainEventType, DomainEventConsumer>;

  constructor(@Inject(DOMAIN_EVENT_CONSUMERS) consumers: DomainEventConsumer[]) {
    this.consumersByType = new Map(consumers.map((consumer) => [consumer.eventType, consumer]));
  }

  getConsumer(eventType: DomainEventType): DomainEventConsumer | undefined {
    return this.consumersByType.get(eventType);
  }
}
