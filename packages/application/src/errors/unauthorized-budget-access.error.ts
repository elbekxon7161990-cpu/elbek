import { ApplicationError } from './application.error';

/** A user must never edit/delete/view another user's budget — never trust a client-supplied `budgetId` alone, even under RLS (defense-in-depth, this task's own explicit architecture requirement). */
export class UnauthorizedBudgetAccessError extends ApplicationError {
  constructor(budgetId: string, userId: string) {
    super(`User "${userId}" is not authorized to access budget "${budgetId}".`);
  }
}
