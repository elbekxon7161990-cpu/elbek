import { ApplicationError } from './application.error';

/** TASK-FIN-REAL-001 — the candidate's `intent` isn't one TASK-FIN-001's use cases can persist (only EXPENSE/INCOME/SALARY/REFUND); e.g. a DEBT_GIVEN, TRANSFER, or QUERY_REPORT intent reaching commitRequested. Never invents a transaction type the repository doesn't already define. */
export class UnsupportedTransactionIntentError extends ApplicationError {
  constructor(intent: string) {
    super(
      `Cannot commit a transaction for intent "${intent}" — no supporting use case exists yet.`,
    );
  }
}
