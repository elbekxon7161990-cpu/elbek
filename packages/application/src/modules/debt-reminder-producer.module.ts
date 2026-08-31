import { Module } from '@nestjs/common';

import { RecordDebtReminderEventsUseCase } from '../use-cases/record-debt-reminder-events.use-case';

/**
 * Debt Reminder Producer task — does not bind DEBT_REMINDER_REPOSITORY/
 * DOMAIN_EVENT_REPOSITORY — the composition root's job, same split as
 * every other module in this package.
 */
@Module({
  providers: [RecordDebtReminderEventsUseCase],
  exports: [RecordDebtReminderEventsUseCase],
})
export class DebtReminderProducerModule {}
