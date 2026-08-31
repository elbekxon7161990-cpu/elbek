import { Global, Module } from '@nestjs/common';
import { DEBT_REMINDER_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaDebtReminderRepository } from './prisma-debt-reminder.repository';

/** Binds @afa/domain's DEBT_REMINDER_REPOSITORY port to the Prisma implementation. `@Global()` — same pattern as `debt-repository.module.ts`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: DEBT_REMINDER_REPOSITORY, useClass: PrismaDebtReminderRepository }],
  exports: [DEBT_REMINDER_REPOSITORY],
})
export class DebtReminderRepositoryModule {}
