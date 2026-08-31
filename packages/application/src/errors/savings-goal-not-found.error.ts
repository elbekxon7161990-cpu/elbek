import { ApplicationError } from './application.error';

export class SavingsGoalNotFoundError extends ApplicationError {
  constructor(goalId: string) {
    super(`SavingsGoal not found: "${goalId}".`);
  }
}
