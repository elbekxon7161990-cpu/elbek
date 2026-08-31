import { ApplicationError } from './application.error';

export class UnauthorizedTransactionAccessError extends ApplicationError {
  constructor(transactionId: string, userId: string) {
    super(`User "${userId}" is not authorized to access transaction "${transactionId}".`);
  }
}
