import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { RecordDebtReminderEventsUseCase } from '@afa/application';
import { DEBT_REMINDER_SCAN_QUEUE_NAME } from '@afa/infrastructure';

/**
 * Debt Reminder Producer task — the thin BullMQ wiring for one eligibility-
 * scan cycle, mirroring `DomainEventDispatchProcessor`'s own exact shape.
 * All real policy (eligibility classification, dedup) lives in
 * `RecordDebtReminderEventsUseCase` (`@afa/application`), already fully
 * unit-tested with fakes; this class only triggers and reports.
 *
 * Never logs payload-level detail (counterparty names, amounts) — only
 * aggregate counts, matching `DomainEventDispatchProcessor`'s own Chapter
 * 16 §16.3 data-minimization discipline.
 */
@Processor(DEBT_REMINDER_SCAN_QUEUE_NAME)
@Injectable()
export class DebtReminderScanProcessor extends WorkerHost {
  private readonly logger = new Logger(DebtReminderScanProcessor.name);

  constructor(private readonly recordDebtReminderEvents: RecordDebtReminderEventsUseCase) {
    super();
  }

  async process(): Promise<{
    candidatesScanned: number;
    approachingEmitted: number;
    overdueEmitted: number;
  }> {
    const summary = await this.recordDebtReminderEvents.execute();

    if (summary.approachingEmitted > 0 || summary.overdueEmitted > 0) {
      this.logger.log(
        `Debt-reminder scan: ${summary.candidatesScanned} candidate(s), ` +
          `${summary.approachingEmitted} DebtDueApproaching emitted, ` +
          `${summary.overdueEmitted} DebtOverdue emitted, ` +
          `${summary.skippedAsDuplicate} skipped as duplicate.`,
      );
    }

    return {
      candidatesScanned: summary.candidatesScanned,
      approachingEmitted: summary.approachingEmitted,
      overdueEmitted: summary.overdueEmitted,
    };
  }
}
