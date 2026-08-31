import { Global, Module } from '@nestjs/common';
import { NOTIFICATION_PREFERENCE_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaNotificationPreferenceRepository } from './prisma-notification-preference.repository';

/** Binds @afa/domain's NOTIFICATION_PREFERENCE_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `transaction-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: NOTIFICATION_PREFERENCE_REPOSITORY,
      useClass: PrismaNotificationPreferenceRepository,
    },
  ],
  exports: [NOTIFICATION_PREFERENCE_REPOSITORY],
})
export class NotificationPreferenceRepositoryModule {}
