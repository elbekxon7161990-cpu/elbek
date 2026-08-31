import { ApplicationError } from './application.error';

/**
 * TASK-SEC-006 — thrown for every reason a support session cannot be used:
 * unknown/expired/closed session, or a caller who is not the session's own
 * agent. One error, one generic outward rejection — the caller learns
 * nothing about which specific reason applied.
 */
export class SupportSessionInvalidError extends ApplicationError {
  constructor() {
    super('This support session is not available.');
  }
}
