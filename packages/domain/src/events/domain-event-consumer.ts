import type { DomainEventRecord } from '../repositories/domain-event.repository';
import type { DomainEventType } from './domain-event';

/**
 * FR-DB-015 — a synchronous, in-process handler for exactly one catalogued
 * event type (§8.22.2). `handle` runs inside the dispatcher's own claim
 * transaction (`DomainEventRepository.dispatchNextPending`) — it must be
 * fast (no outbound network call to a slow third party; §13.30.4's crash-
 * safety reasoning and this task's own architecture-decision report both
 * assume an internal, quick consumer, never e.g. a direct Telegram send)
 * and, per `FR-FIN-048`, idempotent (at-least-once delivery — a retried or
 * re-delivered event must never cause a duplicate side effect).
 *
 * No implementation of this interface is provided by FR-DB-015 itself —
 * TASK-DB-009/TASK-BOT-009 (the real cache-invalidation/notification
 * consumers) are explicitly out of this task's scope. See
 * `DomainEventConsumerRegistry`'s own doc comment for how an empty registry
 * is a normal, expected production state today.
 */
export interface DomainEventConsumer {
  readonly eventType: DomainEventType;
  handle(event: DomainEventRecord): Promise<void>;
}

export const DOMAIN_EVENT_CONSUMER_REGISTRY = Symbol('DOMAIN_EVENT_CONSUMER_REGISTRY');

/**
 * DI-injected lookup, keyed by `event_type`. `getConsumer` returning
 * `undefined` is not an error condition of the registry — it is the
 * expected outcome for 11 of the 12 catalogued event types today (only
 * `TransactionCommitted` has a real producer; zero event types have a real
 * consumer yet) — `DispatchDomainEventsUseCase` is what turns "no consumer"
 * into the terminal `failed` policy §9 of this task's own instructions
 * requires; this port only answers the lookup.
 */
export interface DomainEventConsumerRegistry {
  getConsumer(eventType: DomainEventType): DomainEventConsumer | undefined;
}
