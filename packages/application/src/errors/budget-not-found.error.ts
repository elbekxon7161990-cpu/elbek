import { ApplicationError } from './application.error';

export class BudgetNotFoundError extends ApplicationError {
  constructor(budgetId: string) {
    super(`Budget not found: "${budgetId}".`);
  }
}
