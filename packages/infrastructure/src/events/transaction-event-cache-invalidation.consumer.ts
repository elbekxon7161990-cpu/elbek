import { Inject, Injectable } from '@nestjs/common';
import {
  computeReportCachePeriods,
  dedupeReportCachePeriods,
  parseTransactionCommittedPayload,
  parseTransactionDeletedPayload,
  parseTransactionEditedPayload,
  REPORT_CACHE_REPOSITORY,
  type DomainEventConsumer,
  type DomainEventRecord,
  type ReportCacheRepository,
} from '@afa/domain';

/**
 * TASK-DB-009 (FR-DB-025) — the real cache-invalidation logic, shared by
 * three thin per-event-type `DomainEventConsumer` adapters below.
 * `DomainEventConsumer` (FR-DB-015, `@afa/domain`) is one-consumer-per-
 * event-type by design — this class is not itself a `DomainEventConsumer`,
 * it is the handler the three wrappers delegate to, so the FR-DB-015
 * registry contract does not need to change to support one underlying
 * implementation serving three related event types.
 *
 * Every method throws on a malformed/unsupported payload (via the
 * `parse*Payload` functions, `@afa/domain`) rather than silently doing
 * nothing — "fail safely" here means FR-DB-015's own existing retry/
 * terminal-failure machinery sees the failure and handles it, not that this
 * class invents its own recovery policy.
 */
@Injectable()
export class TransactionEventCacheInvalidationConsumer {
  constructor(@Inject(REPORT_CACHE_REPOSITORY) private readonly cache: ReportCacheRepository) {}

  async handleTransactionCommitted(event: DomainEventRecord): Promise<void> {
    const payload = parseTransactionCommittedPayload(event.payload);
    const periods = computeReportCachePeriods(new Date(payload.transactionDate));
    await this.cache.invalidate(payload.userId, periods);
  }

  async handleTransactionEdited(event: DomainEventRecord): Promise<void> {
    const payload = parseTransactionEditedPayload(event.payload);
    const periods = dedupeReportCachePeriods([
      ...computeReportCachePeriods(new Date(payload.previousTransactionDate)),
      ...computeReportCachePeriods(new Date(payload.newTransactionDate)),
    ]);
    await this.cache.invalidate(payload.userId, periods);
  }

  async handleTransactionDeleted(event: DomainEventRecord): Promise<void> {
    const payload = parseTransactionDeletedPayload(event.payload);
    const periods = computeReportCachePeriods(new Date(payload.transactionDate));
    await this.cache.invalidate(payload.userId, periods);
  }
}

/**
 * The three `DOMAIN_EVENT_CONSUMERS` registry entries this task adds —
 * see `domain-event-consumer-registry.module.ts` for where these are bound.
 */
export function buildTransactionEventCacheInvalidationConsumers(
  handler: TransactionEventCacheInvalidationConsumer,
): DomainEventConsumer[] {
  return [
    {
      eventType: 'TransactionCommitted',
      handle: (event) => handler.handleTransactionCommitted(event),
    },
    { eventType: 'TransactionEdited', handle: (event) => handler.handleTransactionEdited(event) },
    { eventType: 'TransactionDeleted', handle: (event) => handler.handleTransactionDeleted(event) },
  ];
}
