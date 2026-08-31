import { ApplicationError } from './application.error';

/** A user must never link a contribution/transfer to another user's savings goal — never trust a client-supplied `goalId` alone, even under RLS (defense-in-depth, the same discipline `UnauthorizedAccountAccessError` already established). */
export class UnauthorizedGoalAccessError extends ApplicationError {
  constructor(goalId: string, userId: string) {
    super(`User "${userId}" is not authorized to access savings goal "${goalId}".`);
  }
}
