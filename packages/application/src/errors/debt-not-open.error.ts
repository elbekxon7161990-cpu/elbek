import { ApplicationError } from './application.error';

/** FR-DBT-005 — forgiving a debt that is already `'repaid'`/`'forgiven'` (or was concurrently transitioned by another call) is rejected, never silently re-applied. */
export class DebtNotOpenError extends ApplicationError {
  constructor(debtId: string, status: string) {
    super(`Debt "${debtId}" is not open (status: "${status}") and cannot be settled.`);
  }
}
