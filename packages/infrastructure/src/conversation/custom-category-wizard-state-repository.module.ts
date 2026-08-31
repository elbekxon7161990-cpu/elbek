import { Global, Module } from '@nestjs/common';
import { CUSTOM_CATEGORY_WIZARD_STATE_REPOSITORY } from '@afa/domain';

import { RedisModule } from '../redis/redis.module';
import { RedisCustomCategoryWizardStateRepository } from './redis-custom-category-wizard-state.repository';

/**
 * TASK-FIN-006 — binds @afa/domain's `CUSTOM_CATEGORY_WIZARD_STATE_REPOSITORY`
 * port to the Redis implementation. Mirrors `LoanWizardStateRepositoryModule`'s
 * own shape exactly, including `@Global()` for the same reason.
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: CUSTOM_CATEGORY_WIZARD_STATE_REPOSITORY,
      useClass: RedisCustomCategoryWizardStateRepository,
    },
  ],
  exports: [CUSTOM_CATEGORY_WIZARD_STATE_REPOSITORY],
})
export class CustomCategoryWizardStateRepositoryModule {}
