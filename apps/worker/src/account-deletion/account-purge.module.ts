import { Module } from '@nestjs/common';
import { PurgeExpiredAccountsModule } from '@afa/application';
import {
  AccountPurgeNotificationQueueRepositoryModule,
  AccountPurgeQueueModule,
  AccountPurgeRepositoryModule,
  UserRepositoryModule,
} from '@afa/infrastructure';

import { AccountPurgeProcessor } from './account-purge.processor';
import { AccountPurgeScheduler } from './account-purge.scheduler';
import { ObjectStorageBindingModule } from './object-storage-binding.module';

/**
 * TASK-AUTH-006 — composition-root wiring, mirroring `BudgetRolloverModule`'s
 * own shape. Imports `PurgeExpiredAccountsModule` specifically (NOT
 * `AccountDeletionModule`, which carries `apps/telegram-bot`'s own
 * `RequestAccountDeletionUseCase`/`CancelAccountDeletionUseCase` instead) —
 * see `PurgeExpiredAccountsModule`'s own doc comment for the real DI-
 * resolution bug that split fixes. `ObjectStorageBindingModule` is imported
 * here, not in `AppModule` directly, so this feature's own composition
 * (including its disclosed limitation) stays self-contained in one place —
 * see that module's own doc comment.
 */
@Module({
  imports: [
    PurgeExpiredAccountsModule,
    UserRepositoryModule,
    AccountPurgeRepositoryModule,
    AccountPurgeQueueModule,
    AccountPurgeNotificationQueueRepositoryModule,
    ObjectStorageBindingModule,
  ],
  providers: [AccountPurgeProcessor, AccountPurgeScheduler],
})
export class AccountPurgeModule {}
