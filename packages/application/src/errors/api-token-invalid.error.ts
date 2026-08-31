import { ApplicationError } from './application.error';

/** TASK-AUTH-003 — the ApiTokenGuard-level generic error (missing/malformed/unknown/revoked/expired token), mirrors `AdminSessionInvalidError`. */
export class ApiTokenInvalidError extends ApplicationError {
  constructor() {
    super('Invalid or expired API token.');
  }
}
