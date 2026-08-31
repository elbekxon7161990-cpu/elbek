import { Module } from '@nestjs/common';

import { ProvisionTelegramUserUseCase } from '../use-cases/provision-telegram-user.use-case';

/**
 * Does not bind USER_REPOSITORY — that's the composition root's job
 * (packages/infrastructure's UserRepositoryModule, imported alongside this
 * one by whichever apps/* app needs it). See package.json's description.
 */
@Module({
  providers: [ProvisionTelegramUserUseCase],
  exports: [ProvisionTelegramUserUseCase],
})
export class AuthModule {}
