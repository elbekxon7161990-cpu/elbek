import { ApplicationError } from './application.error';

/**
 * TASK-FIN-004 (FR-FIN-006) — thrown by `EditTransactionUseCase` when a
 * TRANSFER edit leaves `destinationAmount` inconsistent with the (re-derived,
 * account-aware) cross-currency status of the edited transfer: either a
 * value is present for what is now a same-currency transfer, or a stale
 * value from a formerly cross-currency transfer was not explicitly cleared
 * (`destinationAmount: null`) in the same edit that changed `currency`.
 */
export class InvalidDestinationAmountEditError extends ApplicationError {
  constructor(reason: string) {
    super(reason);
  }
}
