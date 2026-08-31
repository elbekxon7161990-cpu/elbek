import { Module } from '@nestjs/common';

import { PurgeExpiredAccountsUseCase } from '../use-cases/purge-expired-accounts.use-case';

/**
 * TASK-AUTH-006 — deliberately separate from `AccountDeletionModule`
 * (which carries `RequestAccountDeletionUseCase`/`CancelAccountDeletionUseCase`,
 * `apps/telegram-bot`'s own concern), even though both belong to the same
 * Account Deletion Flow capability: only `apps/worker`'s scheduled purge
 * job needs `PurgeExpiredAccountsUseCase`, and therefore only `apps/worker`
 * needs `ACCOUNT_PURGE_REPOSITORY`/`ACCOUNT_PURGE_NOTIFICATION_QUEUE`
 * resolvable in its DI graph. See `account-deletion.module.ts`'s own doc
 * comment for the real DI-resolution bug this split fixes. Does not bind
 * `USER_REPOSITORY`, `ACCOUNT_PURGE_REPOSITORY`, or
 * `ACCOUNT_PURGE_NOTIFICATION_QUEUE` — the composition root's job.
 */
@Module({
  providers: [PurgeExpiredAccountsUseCase],
  exports: [PurgeExpiredAccountsUseCase],
})
export class PurgeExpiredAccountsModule {}
