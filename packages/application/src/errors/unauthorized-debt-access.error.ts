import { ApplicationError } from './application.error';

/** BR-DBT-002 — debts are strictly scoped to the user's own counterparties/records; one user must never forgive or otherwise mutate another user's debt. */
export class UnauthorizedDebtAccessError extends ApplicationError {
  constructor(debtId: string, userId: string) {
    super(`User "${userId}" is not authorized to access debt "${debtId}".`);
  }
}
