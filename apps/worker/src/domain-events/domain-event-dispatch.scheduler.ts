import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { DOMAIN_EVENT_DISPATCH_QUEUE_NAME } from '@afa/infrastructure';

/**
 * FR-DB-015 — schedules the BullMQ repeatable job that fires
 * `DomainEventDispatchProcessor.process()` every
 * `DOMAIN_EVENT_POLL_INTERVAL_MS`. The job carries no payload — see
 * `DomainEventDispatchQueueModule`'s own doc comment for why (this is a
 * periodic *trigger*, never a payload carrier). Re-adding the same repeat
 * spec on every process boot is BullMQ's own documented idempotent
 * behavior (a repeatable job is keyed by its name + repeat options), so
 * restarts never accumulate duplicate scheduled jobs.
 */
@Injectable()
export class DomainEventDispatchScheduler implements OnModuleInit {
  private readonly logger = new Logger(DomainEventDispatchScheduler.name);

  constructor(
    @InjectQueue(DOMAIN_EVENT_DISPATCH_QUEUE_NAME) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const pollIntervalMs = this.configService.get<number>('DOMAIN_EVENT_POLL_INTERVAL_MS', 1000);
    await this.queue.add(
      DOMAIN_EVENT_DISPATCH_QUEUE_NAME,
      {},
      { repeat: { every: pollIntervalMs } },
    );
    this.logger.log(`Domain-event dispatch poll scheduled every ${pollIntervalMs}ms`);
  }
}
