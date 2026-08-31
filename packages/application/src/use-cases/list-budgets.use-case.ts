import { Inject, Injectable } from '@nestjs/common';
import type { BudgetRepository, BudgetUtilization } from '@afa/domain';
import { BUDGET_REPOSITORY } from '@afa/domain';

export interface ListBudgetsInput {
  userId: string;
  asOf?: Date;
}

/** FR-BUD-006 — `/budget`: every active budget with its live utilization (§8.14.4), never a stale cached percentage (FR-BUD-004). */
@Injectable()
export class ListBudgetsUseCase {
  constructor(@Inject(BUDGET_REPOSITORY) private readonly budgetRepository: BudgetRepository) {}

  async execute(input: ListBudgetsInput): Promise<BudgetUtilization[]> {
    return this.budgetRepository.computeUtilizationForAllActive(
      input.userId,
      input.asOf ?? new Date(),
    );
  }
}
