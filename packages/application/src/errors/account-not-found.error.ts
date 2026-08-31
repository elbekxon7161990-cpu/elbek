import { ApplicationError } from './application.error';

export class AccountNotFoundError extends ApplicationError {
  constructor(accountId: string) {
    super(`Account not found: "${accountId}".`);
  }
}
