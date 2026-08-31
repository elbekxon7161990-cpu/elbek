import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { RolloverBudgetPeriodsUseCase } from '@afa/application';
import { BUDGET_ROLLOVER_QUEUE_NAME } from '@afa/infrastructure';

/**
 * TASK-FIN-003 — the thin BullMQ wiring for one rollover cycle, mirroring
 * `DebtReminderScanProcessor`'s own exact shape. All real policy (which
 * budgets are due, the atomic advance) lives in
 * `RolloverBudgetPeriodsUseCase` (`@afa/application`), already fully
 * unit-tested with a fake repository; this class only triggers and reports.
 *
 * Never logs budget-level detail (limit amounts, category names) — only
 * aggregate counts, matching `DebtReminderScanProcessor`'s own Chapter 16
 * §16.3 data-minimization discipline.
 */
@Processor(BUDGET_ROLLOVER_QUEUE_NAME)
@Injectable()
export class BudgetRolloverProcessor extends WorkerHost {
  private readonly logger = new Logger(BudgetRolloverProcessor.name);

  constructor(private readonly rolloverBudgetPeriods: RolloverBudgetPeriodsUseCase) {
    super();
  }

  async process(): Promise<{ candidatesScanned: number; rolledOver: number }> {
    const summary = await this.rolloverBudgetPeriods.execute();

    if (summary.rolledOver > 0 || summary.skippedAsRace > 0) {
      this.logger.log(
        `Budget-rollover scan: ${summary.candidatesScanned} candidate(s), ` +
          `${summary.rolledOver} rolled over, ${summary.skippedAsRace} skipped as race.`,
      );
    }

    return { candidatesScanned: summary.candidatesScanned, rolledOver: summary.rolledOver };
  }
}
