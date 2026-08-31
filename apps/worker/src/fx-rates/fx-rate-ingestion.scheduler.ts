import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { FX_RATE_INGESTION_QUEUE_NAME } from '@afa/infrastructure';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * TASK-FIN-007 Stage F (FR-INT-003 — "refreshed at least daily"). Mirrors
 * `BudgetRolloverScheduler`'s exact shape: a BullMQ repeatable job with no
 * payload, registered once at module init.
 */
@Injectable()
export class FxRateIngestionScheduler implements OnModuleInit {
  private readonly logger = new Logger(FxRateIngestionScheduler.name);

  constructor(
    @InjectQueue(FX_RATE_INGESTION_QUEUE_NAME) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const intervalMs = this.configService.get<number>('FX_RATE_INGESTION_INTERVAL_MS', ONE_DAY_MS);
    await this.queue.add(FX_RATE_INGESTION_QUEUE_NAME, {}, { repeat: { every: intervalMs } });
    this.logger.log(`FX-rate ingestion scheduled every ${intervalMs}ms`);
  }
}
