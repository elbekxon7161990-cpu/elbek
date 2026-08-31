import { ApplicationError } from './application.error';

/** FR-EXP-003 — unsupported currency triggers clarification, never silent coercion. */
export class InvalidCurrencyError extends ApplicationError {
  constructor(currency: string) {
    super(`Unsupported currency: "${currency}".`);
  }
}
