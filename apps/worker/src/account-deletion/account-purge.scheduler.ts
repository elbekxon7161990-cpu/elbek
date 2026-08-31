import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { ACCOUNT_PURGE_QUEUE_NAME } from '@afa/infrastructure';

/**
 * TASK-AUTH-006 (FR-RET-002 — the 30-day-grace-period scheduled purge).
 * Mirrors `BudgetRolloverScheduler`'s exact shape and its own disclosed
 * "poll frequently, let per-record eligibility do the real correctness
 * work" reasoning — `UserRepository.findExpiredPendingDeletions` already
 * derives eligibility from a real, current `now` on every poll, so a
 * default 30-minute interval is comfortably safe: it only changes how
 * promptly (never whether) an expired account is actually purged, and
 * cancellation remains possible up to the exact moment `findExpiredPendingDeletions`
 * would first surface a given user (`UserRepository.cancelDeletion`'s own
 * doc comment).
 */
@Injectable()
export class AccountPurgeScheduler implements OnModuleInit {
  private readonly logger = new Logger(AccountPurgeScheduler.name);

  constructor(
    @InjectQueue(ACCOUNT_PURGE_QUEUE_NAME) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const scanIntervalMs = this.configService.get<number>(
      'ACCOUNT_PURGE_SCAN_INTERVAL_MS',
      30 * 60 * 1000,
    );
    await this.queue.add(ACCOUNT_PURGE_QUEUE_NAME, {}, { repeat: { every: scanIntervalMs } });
    this.logger.log(`Account-purge scan scheduled every ${scanIntervalMs}ms`);
  }
}
