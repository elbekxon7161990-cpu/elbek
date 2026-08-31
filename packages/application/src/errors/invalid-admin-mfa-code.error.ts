import { ApplicationError } from './application.error';

/**
 * TASK-AUTH-002 — the MFA-step equivalent of InvalidAdminCredentialsError:
 * one generic error for an expired/missing challenge, a wrong TOTP code, or
 * an account that became locked between the password step and this step —
 * "invalid MFA must produce generic authentication failure behavior
 * externally".
 */
export class InvalidAdminMfaCodeError extends ApplicationError {
  constructor() {
    super('Invalid authentication code.');
  }
}
