import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AccountPurgeNotificationQueue,
  AccountPurgeRepository,
  UserRepository,
} from '@afa/domain';
import {
  ACCOUNT_PURGE_NOTIFICATION_QUEUE,
  ACCOUNT_PURGE_REPOSITORY,
  USER_REPOSITORY,
} from '@afa/domain';

export interface PurgeExpiredAccountsSummary {
  candidateCount: number;
  purgedCount: number;
  storageFailureCount: number;
}

/**
 * TASK-AUTH-006 (FR-RET-002) — the scheduled purge job's own real policy,
 * triggered by `apps/worker`'s `AccountPurgeProcessor` (mirrors
 * `RolloverBudgetPeriodsUseCase`'s own "one process() call handles the
 * whole batch" shape). Candidate selection
 * (`UserRepository.findExpiredPendingDeletions`) and the actual destructive
 * work (`AccountPurgeRepository.purgeUser`) are each already independently
 * correct/idempotent/atomic-where-it-matters — see their own doc comments
 * — so this use case's only real job is the loop and the final-confirmation
 * hand-off, never re-deciding eligibility itself.
 *
 * The final "irreversible completion" message is enqueued ONLY for a
 * `'purged'` outcome — never for `'storage_failure'` (FR-RET-002's own
 * "never a false success" requirement) — matching `AccountPurgeRepository`'s
 * own contract that a `'storage_failure'` outcome leaves the `users` row
 * untouched, so there is nothing final to confirm yet.
 */
@Injectable()
export class PurgeExpiredAccountsUseCase {
  private readonly logger = new Logger(PurgeExpiredAccountsUseCase.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ACCOUNT_PURGE_REPOSITORY)
    private readonly accountPurgeRepository: AccountPurgeRepository,
    @Inject(ACCOUNT_PURGE_NOTIFICATION_QUEUE)
    private readonly notificationQueue: AccountPurgeNotificationQueue,
  ) {}

  async execute(now: Date = new Date()): Promise<PurgeExpiredAccountsSummary> {
    const candidates = await this.userRepository.findExpiredPendingDeletions(now);

    let purgedCount = 0;
    let storageFailureCount = 0;

    for (const user of candidates) {
      const outcome = await this.accountPurgeRepository.purgeUser(
        {
          id: user.id,
          telegramUserId: user.telegramUserId,
          preferredLanguage: user.preferredLanguage,
        },
        now,
      );

      if (outcome.kind === 'purged') {
        purgedCount += 1;
        await this.notificationQueue.enqueue(
          outcome.candidate.telegramUserId.toString(),
          outcome.candidate.preferredLanguage,
        );
      } else {
        storageFailureCount += 1;
        this.logger.warn(
          `Account purge storage_failure for a pending_deletion user — users row and Postgres data left in place, will retry on next scan.`,
        );
      }
    }

    return { candidateCount: candidates.length, purgedCount, storageFailureCount };
  }
}
