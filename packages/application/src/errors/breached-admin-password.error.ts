import { ApplicationError } from './application.error';

/** TASK-AUTH-002 (§7.1.8) — "...not on breached-password blocklist". */
export class BreachedAdminPasswordError extends ApplicationError {
  constructor() {
    super('Password appears in a known breach corpus and cannot be used.');
  }
}
