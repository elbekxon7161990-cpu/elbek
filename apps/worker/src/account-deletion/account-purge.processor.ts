import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PurgeExpiredAccountsUseCase } from '@afa/application';
import { ACCOUNT_PURGE_QUEUE_NAME } from '@afa/infrastructure';

/**
 * TASK-AUTH-006 — the thin BullMQ wiring for one purge-scan cycle, mirroring
 * `BudgetRolloverProcessor`'s own exact shape. All real policy (candidate
 * selection, the FK-ordered destructive purge, the final-notification
 * hand-off) lives in `PurgeExpiredAccountsUseCase`/`AccountPurgeRepository`
 * (`@afa/application`/`@afa/infrastructure`), already unit-tested; this
 * class only triggers and reports.
 *
 * Never logs per-user detail (no user id, no telegram id) — only aggregate
 * counts, matching `BudgetRolloverProcessor`'s own Chapter 16 §16.3
 * data-minimization discipline.
 */
@Processor(ACCOUNT_PURGE_QUEUE_NAME)
@Injectable()
export class AccountPurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountPurgeProcessor.name);

  constructor(private readonly purgeExpiredAccounts: PurgeExpiredAccountsUseCase) {
    super();
  }

  async process(): Promise<{
    candidateCount: number;
    purgedCount: number;
    storageFailureCount: number;
  }> {
    const summary = await this.purgeExpiredAccounts.execute();

    if (summary.candidateCount > 0) {
      this.logger.log(
        `Account-purge scan: ${summary.candidateCount} candidate(s), ` +
          `${summary.purgedCount} purged, ${summary.storageFailureCount} storage_failure(s).`,
      );
    }

    return summary;
  }
}
