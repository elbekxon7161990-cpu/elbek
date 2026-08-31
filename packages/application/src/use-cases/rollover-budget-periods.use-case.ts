import { Inject, Injectable } from '@nestjs/common';
import {
  BUDGET_REPOSITORY,
  computeNextBudgetPeriodBoundaries,
  type BudgetRepository,
} from '@afa/domain';

export interface RolloverBudgetPeriodsSummary {
  candidatesScanned: number;
  rolledOver: number;
  skippedAsRace: number;
}

/**
 * TASK-FIN-003 (FR-BUD-003, NFR-BUD-002) — "automatically recur a budget
 * for the next period upon period rollover... reset the 'used' tracking to
 * zero at each period boundary (in the user's timezone)." Mirrors
 * `RecordDebtReminderEventsUseCase`'s own "policy above, mechanics below"
 * split on top of `BudgetRepository`: eligibility (`findDueForRollover`,
 * per-user-timezone-aware) and the atomic conditional advance
 * (`rolloverPeriod`) both live in the repository; this use case is only the
 * orchestration loop, already fully unit-testable with a fake repository.
 *
 * `skippedAsRace` counts a `rolloverPeriod` call that returned `null`
 * because a concurrent run (or a manual edit) already changed
 * `currentPeriodEnd` since `findDueForRollover` read it — expected,
 * harmless, not an error (the optimistic-concurrency guard working as
 * designed, mirroring `DebtRepository.forgive`'s own `null`-return
 * reasoning).
 */
@Injectable()
export class RolloverBudgetPeriodsUseCase {
  constructor(@Inject(BUDGET_REPOSITORY) private readonly budgetRepository: BudgetRepository) {}

  async execute(now: Date = new Date()): Promise<RolloverBudgetPeriodsSummary> {
    const dueBudgets = await this.budgetRepository.findDueForRollover(now);

    let rolledOver = 0;
    let skippedAsRace = 0;

    for (const budget of dueBudgets) {
      const { currentPeriodStart, currentPeriodEnd } = computeNextBudgetPeriodBoundaries(
        budget.currentPeriodEnd,
        budget.periodType,
      );

      const result = await this.budgetRepository.rolloverPeriod(
        budget.id,
        budget.currentPeriodEnd,
        currentPeriodStart,
        currentPeriodEnd,
      );

      if (result === null) {
        skippedAsRace += 1;
      } else {
        rolledOver += 1;
      }
    }

    return { candidatesScanned: dueBudgets.length, rolledOver, skippedAsRace };
  }
}
