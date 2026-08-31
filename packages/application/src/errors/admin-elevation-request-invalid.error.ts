import { ApplicationError } from './application.error';

/**
 * TASK-AUTH-005 — thrown by `ApproveAdminElevationUseCase` for every reason
 * an elevation approval attempt is rejected (unknown request, expired,
 * already resolved, lost the atomic-consume race, or the caller is the
 * request's own target admin) — one error, one generic outward rejection,
 * same "must not leak which specific reason" discipline
 * `AdminSessionInvalidError`/`InvalidRefreshTokenError` already establish:
 * self-elevation and "this request doesn't exist" must be indistinguishable
 * from the outside.
 */
export class AdminElevationRequestInvalidError extends ApplicationError {
  constructor() {
    super('This elevation request cannot be approved.');
  }
}
