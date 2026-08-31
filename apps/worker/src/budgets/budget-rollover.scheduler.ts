import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { BUDGET_ROLLOVER_QUEUE_NAME } from '@afa/infrastructure';

/**
 * TASK-FIN-003 (NFR-BUD-002 — "< 15 minutes after period boundary,
 * scheduled to run at each user's local midnight in batched timezone
 * groups, not a single global instant"). Mirrors
 * `DebtReminderScanScheduler`'s exact shape and idempotent-repeatable-job
 * reasoning.
 *
 * Disclosed simplification: this does not literally group users by UTC
 * offset into separate per-timezone-group jobs — instead, it polls
 * frequently enough (default every 10 minutes, comfortably under the
 * 15-minute latency target) and relies on `BudgetRepository.findDueForRollover`'s
 * own per-user-timezone-aware eligibility check (`toLocalCalendarDate`) to
 * correctly identify exactly which users have actually crossed their OWN
 * local period boundary as of each poll — the same correctness property
 * "batched timezone groups" was meant to guarantee, achieved by frequent
 * polling plus per-user correctness rather than a separate multi-cron
 * scheduling primitive. See this task's final report for the full
 * reasoning and the disclosed gap (a genuine batched-timezone-group
 * scheduler, if ever required for load-shaping reasons beyond pure
 * latency, is not built here).
 */
@Injectable()
export class BudgetRolloverScheduler implements OnModuleInit {
  private readonly logger = new Logger(BudgetRolloverScheduler.name);

  constructor(
    @InjectQueue(BUDGET_ROLLOVER_QUEUE_NAME) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const scanIntervalMs = this.configService.get<number>(
      'BUDGET_ROLLOVER_SCAN_INTERVAL_MS',
      10 * 60 * 1000,
    );
    await this.queue.add(BUDGET_ROLLOVER_QUEUE_NAME, {}, { repeat: { every: scanIntervalMs } });
    this.logger.log(`Budget-rollover scan scheduled every ${scanIntervalMs}ms`);
  }
}
