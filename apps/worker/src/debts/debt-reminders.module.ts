import { Module } from '@nestjs/common';
import { DebtReminderProducerModule } from '@afa/application';
import {
  DebtReminderRepositoryModule,
  DebtReminderScanQueueModule,
  DomainEventRepositoryModule,
} from '@afa/infrastructure';

import { DebtReminderScanProcessor } from './debt-reminder-scan.processor';
import { DebtReminderScanScheduler } from './debt-reminder-scan.scheduler';

/**
 * Debt Reminder Producer task — composition-root wiring, mirroring
 * `DomainEventsModule`'s own shape. Imports `DomainEventRepositoryModule`
 * directly since `RecordDebtReminderEventsUseCase` needs
 * `DOMAIN_EVENT_REPOSITORY` (via `DomainEventRepository.record()`,
 * unmodified) alongside the new `DEBT_REMINDER_REPOSITORY` — both are
 * `@Global()`, so importing them here is safe even if already imported
 * elsewhere in this app's module tree (`DomainEventsModule` already does).
 */
@Module({
  imports: [
    DebtReminderProducerModule,
    DebtReminderRepositoryModule,
    DomainEventRepositoryModule,
    DebtReminderScanQueueModule,
  ],
  providers: [DebtReminderScanProcessor, DebtReminderScanScheduler],
})
export class DebtRemindersModule {}
