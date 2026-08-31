import { Module } from '@nestjs/common';

import { ExpireSupportSessionsUseCase } from '../use-cases/expire-support-sessions.use-case';

/**
 * TASK-SEC-006 — separate from `SupportSessionModule` (apps/api's own
 * controller-facing bundle) for the same reason `PurgeExpiredAccountsModule`
 * is kept separate from `AccountDeletionModule`: this is apps/worker's own
 * narrow slice, not apps/api's.
 */
@Module({
  providers: [ExpireSupportSessionsUseCase],
  exports: [ExpireSupportSessionsUseCase],
})
export class ExpireSupportSessionsModule {}
