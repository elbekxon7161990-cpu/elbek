import { Inject, Injectable } from '@nestjs/common';
import type { Budget, BudgetRepository } from '@afa/domain';
import { BUDGET_REPOSITORY } from '@afa/domain';

import { BudgetNotFoundError } from '../errors/budget-not-found.error';
import { UnauthorizedBudgetAccessError } from '../errors/unauthorized-budget-access.error';

export interface DeleteBudgetInput {
  userId: string;
  budgetId: string;
}

/**
 * FR-BUD-007 — "deleting a budget at any time, with deletion requiring
 * explicit confirmation (not destructive-by-accident)." The confirmation
 * UX itself (an inline Yes/No prompt) is the Telegram layer's own concern,
 * the same split `DeleteTransactionUseCase` already establishes — this use
 * case performs the actual soft-delete only once the caller has already
 * obtained that confirmation.
 */
@Injectable()
export class DeleteBudgetUseCase {
  constructor(@Inject(BUDGET_REPOSITORY) private readonly budgetRepository: BudgetRepository) {}

  async execute(input: DeleteBudgetInput): Promise<Budget> {
    const existing = await this.budgetRepository.findById(input.budgetId);
    if (!existing || existing.isDeleted) {
      throw new BudgetNotFoundError(input.budgetId);
    }
    if (existing.userId !== input.userId) {
      throw new UnauthorizedBudgetAccessError(input.budgetId, input.userId);
    }

    const deleted = await this.budgetRepository.softDelete(input.budgetId, input.userId);
    if (deleted === null) {
      throw new BudgetNotFoundError(input.budgetId);
    }
    return deleted;
  }
}
