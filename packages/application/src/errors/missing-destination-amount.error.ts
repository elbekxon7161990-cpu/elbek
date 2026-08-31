import { ApplicationError } from './application.error';

/**
 * FR-FIN-005 — a cross-currency `TRANSFER` must capture the destination-
 * currency amount, either user-supplied or system-estimated. TASK-FIN-004
 * Stage C deliberately implements only the user-supplied mechanism (see
 * `create-transfer.use-case.ts`'s own doc comment for why the
 * system-estimated path is deferred) — this is thrown when the source and
 * destination accounts' currencies differ and the caller did not supply
 * `destinationAmount`.
 */
export class MissingDestinationAmountError extends ApplicationError {
  constructor(sourceCurrency: string, destinationCurrency: string) {
    super(
      `A destinationAmount is required for a cross-currency transfer from "${sourceCurrency}" to "${destinationCurrency}".`,
    );
  }
}
