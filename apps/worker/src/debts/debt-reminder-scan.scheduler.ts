import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { DEBT_REMINDER_SCAN_QUEUE_NAME } from '@afa/infrastructure';

/**
 * Debt Reminder Producer task — schedules the BullMQ repeatable job that
 * fires `DebtReminderScanProcessor.process()` every
 * `DEBT_REMINDER_SCAN_INTERVAL_MS` (default 24h — a disclosed judgment
 * call, see that env var's own doc comment). Mirrors
 * `DomainEventDispatchScheduler`'s exact shape, including the same
 * idempotent-repeatable-job reasoning (re-adding the same repeat spec on
 * every process boot never accumulates duplicate scheduled jobs).
 */
@Injectable()
export class DebtReminderScanScheduler implements OnModuleInit {
  private readonly logger = new Logger(DebtReminderScanScheduler.name);

  constructor(
    @InjectQueue(DEBT_REMINDER_SCAN_QUEUE_NAME) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const scanIntervalMs = this.configService.get<number>(
      'DEBT_REMINDER_SCAN_INTERVAL_MS',
      24 * 60 * 60 * 1000,
    );
    await this.queue.add(DEBT_REMINDER_SCAN_QUEUE_NAME, {}, { repeat: { every: scanIntervalMs } });
    this.logger.log(`Debt-reminder scan scheduled every ${scanIntervalMs}ms`);
  }
}
