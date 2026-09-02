import { Module } from '@nestjs/common';

import { BlockUserUseCase } from '../use-cases/block-user.use-case';
import { GetUserByIdUseCase } from '../use-cases/get-user-by-id.use-case';
import { ListUsersUseCase } from '../use-cases/list-users.use-case';
import { UnblockUserUseCase } from '../use-cases/unblock-user.use-case';

/** Web admin panel's user-management use cases (list/view/block/unblock). */
@Module({
  providers: [ListUsersUseCase, GetUserByIdUseCase, BlockUserUseCase, UnblockUserUseCase],
  exports: [ListUsersUseCase, GetUserByIdUseCase, BlockUserUseCase, UnblockUserUseCase],
})
export class AdminUsersModule {}
