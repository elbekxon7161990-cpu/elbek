import { ApplicationError } from './application.error';

export class DebtNotFoundError extends ApplicationError {
  constructor(debtId: string) {
    super(`Debt not found: "${debtId}".`);
  }
}
