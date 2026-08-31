import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/**
 * FR-DB-015 — this queue carries no domain-event payloads. It exists purely
 * as a periodic *trigger*: each fired job means "run one Postgres polling
 * cycle," nothing more (see `apps/worker`'s own `DomainEventDispatchProcessor`
 * and `DomainEventDispatchScheduler`, the composition-root pieces that
 * schedule and consume this queue's jobs — this package must never depend on
 * `@afa/application`, so neither lives here, mirroring `SttTranscriptionQueueModule`/
 * `OcrExtractionQueueModule` exactly).
 *
 * `attempts: 1` deliberately — a failed poll *cycle* (e.g. a transient DB
 * connection error) must not be retried by BullMQ's own outer retry
 * mechanism; the next repeatable firing (≤ `DOMAIN_EVENT_POLL_INTERVAL_MS`
 * later) already provides that retry, and letting BullMQ *also* retry the
 * job would double-process nothing unsafe, but is redundant, uncontrolled
 * extra load with no benefit — the real per-event retry policy lives
 * entirely in `domain_events.dispatch_attempts`, not in this queue.
 */
export const DOMAIN_EVENT_DISPATCH_QUEUE_NAME = 'domain-event-dispatch';

@Module({
  imports: [
    BullModule.registerQueue({
      name: DOMAIN_EVENT_DISPATCH_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
  ],
  exports: [BullModule],
})
export class DomainEventDispatchQueueModule {}
