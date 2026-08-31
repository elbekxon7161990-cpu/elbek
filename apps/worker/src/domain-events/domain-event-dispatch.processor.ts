import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DispatchDomainEventsUseCase } from '@afa/application';
import { DOMAIN_EVENT_DISPATCH_QUEUE_NAME } from '@afa/infrastructure';

/**
 * FR-DB-015 — the thin BullMQ wiring for one polling cycle, mirroring
 * `SttTranscriptionProcessor` (TASK-AI-005) exactly: all real policy
 * (consumer lookup, retry-vs-terminal decision) lives in
 * `DispatchDomainEventsUseCase` (`@afa/application`), already fully unit-
 * tested with fakes; this class only reads `DOMAIN_EVENT_BATCH_SIZE`,
 * dispatches, and reports.
 *
 * Never logs event `payload` (Chapter 16 §16.3 data minimization) — only
 * event id/type/outcome/attempt-count, matching `DispatchedEventSummary`'s
 * own deliberately narrow shape. The triggering BullMQ job itself carries no
 * data at all (`DomainEventDispatchQueueModule`'s own doc comment), so there
 * is nothing job-side to accidentally log either.
 */
@Processor(DOMAIN_EVENT_DISPATCH_QUEUE_NAME)
@Injectable()
export class DomainEventDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(DomainEventDispatchProcessor.name);

  constructor(
    private readonly dispatchDomainEvents: DispatchDomainEventsUseCase,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(): Promise<{ processed: number }> {
    const batchSize = this.configService.get<number>('DOMAIN_EVENT_BATCH_SIZE', 50);
    const summaries = await this.dispatchDomainEvents.dispatchBatch(batchSize);

    if (summaries.length > 0) {
      this.logger.log(
        `Domain-event dispatch cycle processed ${summaries.length} event(s): ` +
          JSON.stringify(
            summaries.map((summary) => ({
              eventType: summary.eventType,
              outcome: summary.outcome,
              dispatchAttempts: summary.dispatchAttempts,
            })),
          ),
      );
    }

    return { processed: summaries.length };
  }
}
