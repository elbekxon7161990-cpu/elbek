import { ApplicationError } from './application.error';

/**
 * TASK-AUTH-002 — thrown by ValidateAdminSessionUseCase for every reason a
 * bearer token fails to authorize a protected route (missing, malformed,
 * unknown, revoked, expired, idle-timed-out, or the owning admin no longer
 * active) — one error, one generic outward 401, same reasoning as the
 * login-step errors: a protected route must not leak which specific reason
 * a token was rejected for.
 */
export class AdminSessionInvalidError extends ApplicationError {
  constructor() {
    super('Invalid or expired session.');
  }
}
