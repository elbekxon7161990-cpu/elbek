import { ApplicationError } from './application.error';

/** TASK-AUTH-002 (§7.1.8) — "Admin passwords must meet a minimum complexity policy (length >= 12...)". */
export class WeakAdminPasswordError extends ApplicationError {
  constructor() {
    super('Password does not meet the minimum length policy (>= 12 characters).');
  }
}
