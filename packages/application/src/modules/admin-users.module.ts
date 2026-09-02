import { Module } from '@nestjs/common';

import { BlockUserUseCase } from '../use-cases/block-user.use-case';
import { GetUserByIdUseCase } from '../use-cases/get-user-by-id.use-case';
import { ListUsersUseCase } from '../use-cases/list-users.use-case';
import { ResetUserTransactionsUseCase } from '../use-cases/reset-user-transactions.use-case';
import { UnblockUserUseCase } from '../use-cases/unblock-user.use-case';
import { UpdateUserProfileUseCase } from '../use-cases/update-user-profile.use-case';

/**
 * Web admin panel's user-management use cases (list/view/block/unblock/
 * reset-transactions/edit-profile). `UpdateUserProfileUseCase` is the SAME
 * class `UserSettingsModule` already provides for `/settings` — re-provided
 * here rather than importing that module, same "re-provide a stateless,
 * DI-only class directly" precedent `AdminSessionGuard` already
 * establishes across every admin HTTP module.
 */
@Module({
  providers: [
    ListUsersUseCase,
    GetUserByIdUseCase,
    BlockUserUseCase,
    UnblockUserUseCase,
    ResetUserTransactionsUseCase,
    UpdateUserProfileUseCase,
  ],
  exports: [
    ListUsersUseCase,
    GetUserByIdUseCase,
    BlockUserUseCase,
    UnblockUserUseCase,
    ResetUserTransactionsUseCase,
    UpdateUserProfileUseCase,
  ],
})
export class AdminUsersModule {}
