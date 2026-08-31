import { ApplicationError } from './application.error';

/** A user must never edit/archive/view another user's account — never trust a client-supplied `accountId` alone, even under RLS (defense-in-depth, the same discipline `UnauthorizedBudgetAccessError` already established). */
export class UnauthorizedAccountAccessError extends ApplicationError {
  constructor(accountId: string, userId: string) {
    super(`User "${userId}" is not authorized to access account "${accountId}".`);
  }
}
