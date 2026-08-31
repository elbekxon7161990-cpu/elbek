import { ApplicationError } from './application.error';

export class TransactionNotFoundError extends ApplicationError {
  constructor(transactionId: string) {
    super(`Transaction not found: "${transactionId}".`);
  }
}
