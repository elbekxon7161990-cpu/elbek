import { ApplicationError } from './application.error';

export class TransactionAlreadyDeletedError extends ApplicationError {
  constructor(transactionId: string) {
    super(`Transaction "${transactionId}" is already deleted.`);
  }
}
