import { Global, Module } from '@nestjs/common';
import { NOTIFICATION_DEDUP_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaNotificationDedupRepository } from './prisma-notification-dedup.repository';

/** Binds @afa/domain's NOTIFICATION_DEDUP_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `transaction-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: NOTIFICATION_DEDUP_REPOSITORY, useClass: PrismaNotificationDedupRepository },
  ],
  exports: [NOTIFICATION_DEDUP_REPOSITORY],
})
export class NotificationDedupRepositoryModule {}
