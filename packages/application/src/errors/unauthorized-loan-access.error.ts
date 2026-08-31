import { ApplicationError } from './application.error';

/** A user must never log a payment against another user's loan — never trust a client-supplied `loanId` alone, even under RLS (defense-in-depth, the same discipline `UnauthorizedAccountAccessError`/`UnauthorizedGoalAccessError` already established). */
export class UnauthorizedLoanAccessError extends ApplicationError {
  constructor(loanId: string, userId: string) {
    super(`User "${userId}" is not authorized to access loan "${loanId}".`);
  }
}
