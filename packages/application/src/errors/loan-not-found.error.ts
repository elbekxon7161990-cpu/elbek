import { ApplicationError } from './application.error';

export class LoanNotFoundError extends ApplicationError {
  constructor(loanId: string) {
    super(`Loan not found: "${loanId}".`);
  }
}
