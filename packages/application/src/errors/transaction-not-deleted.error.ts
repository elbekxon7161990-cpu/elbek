import { ApplicationError } from './application.error';

export class TransactionNotDeletedError extends ApplicationError {
  constructor(transactionId: string) {
    super(`Transaction "${transactionId}" is not deleted.`);
  }
}
