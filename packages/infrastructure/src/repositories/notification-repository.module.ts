import { Global, Module } from '@nestjs/common';
import { NOTIFICATION_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaNotificationRepository } from './prisma-notification.repository';

/** Binds @afa/domain's NOTIFICATION_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `transaction-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository }],
  exports: [NOTIFICATION_REPOSITORY],
})
export class NotificationRepositoryModule {}
