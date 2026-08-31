import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { SUPPORT_SESSION_EXPIRY_QUEUE_NAME } from '@afa/infrastructure';

/**
 * TASK-SEC-006 (§11.7.2's "-> Expired: session timeout"). Mirrors
 * `AccountPurgeScheduler`'s exact shape and its own disclosed "poll
 * frequently, let per-record eligibility do the real correctness work"
 * reasoning — `SupportSessionRepository.expireDueSessions` already derives
 * eligibility from a real, current `now` on every poll, and the REACTIVE
 * check on every guarded request is what actually enforces the timeout
 * (see `ExpireSupportSessionsUseCase`'s own doc comment) — this scan only
 * affects how promptly a timed-out session's row is visibly stamped
 * `expired_at`, never whether the timeout itself is enforced.
 */
@Injectable()
export class SupportSessionExpiryScheduler implements OnModuleInit {
  private readonly logger = new Logger(SupportSessionExpiryScheduler.name);

  constructor(
    @InjectQueue(SUPPORT_SESSION_EXPIRY_QUEUE_NAME) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const scanIntervalMs = this.configService.get<number>(
      'SUPPORT_SESSION_EXPIRY_SCAN_INTERVAL_MS',
      5 * 60 * 1000,
    );
    await this.queue.add(
      SUPPORT_SESSION_EXPIRY_QUEUE_NAME,
      {},
      { repeat: { every: scanIntervalMs } },
    );
    this.logger.log(`Support-session expiry scan scheduled every ${scanIntervalMs}ms`);
  }
}
