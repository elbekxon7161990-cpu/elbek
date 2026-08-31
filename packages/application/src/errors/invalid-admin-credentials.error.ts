import { ApplicationError } from './application.error';

/**
 * TASK-AUTH-002 — deliberately the SAME error, SAME message, for every
 * password-step failure cause (unknown email, wrong password, locked
 * account, deactivated account): explicit instruction that a locked-account
 * attempt "must not reveal whether the username exists" — collapsing every
 * cause into one generic outward error is what makes that true. Any
 * cause-specific detail belongs in a log line at the throw site, never in
 * this error's own message.
 */
export class InvalidAdminCredentialsError extends ApplicationError {
  constructor() {
    super('Invalid credentials.');
  }
}
