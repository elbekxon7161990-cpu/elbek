import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ExpireSupportSessionsUseCase } from '@afa/application';
import { SUPPORT_SESSION_EXPIRY_QUEUE_NAME } from '@afa/infrastructure';

/**
 * TASK-SEC-006 — the thin BullMQ wiring for one expiry-scan cycle, mirroring
 * `AccountPurgeProcessor`'s own exact shape. All real policy lives in
 * `ExpireSupportSessionsUseCase`/`SupportSessionRepository`, already
 * unit/integration-tested; this class only triggers and reports. Never
 * logs per-session/per-user detail — only an aggregate count.
 */
@Processor(SUPPORT_SESSION_EXPIRY_QUEUE_NAME)
@Injectable()
export class SupportSessionExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(SupportSessionExpiryProcessor.name);

  constructor(private readonly expireSupportSessions: ExpireSupportSessionsUseCase) {
    super();
  }

  async process(): Promise<{ expiredCount: number }> {
    const summary = await this.expireSupportSessions.execute();

    if (summary.expiredCount > 0) {
      this.logger.log(`Support-session expiry scan: ${summary.expiredCount} session(s) expired.`);
    }

    return summary;
  }
}
