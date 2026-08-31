import { ApplicationError } from './application.error';

/**
 * TASK-AUTH-003 — the SAME generic error for every refresh-step failure
 * cause (unknown/malformed token, expired, already-revoked, replayed, lost
 * the rotation race) — same "must not leak which specific reason"
 * discipline `InvalidAdminCredentialsError` already established in AUTH-002.
 */
export class InvalidRefreshTokenError extends ApplicationError {
  constructor() {
    super('Invalid or expired refresh token.');
  }
}
