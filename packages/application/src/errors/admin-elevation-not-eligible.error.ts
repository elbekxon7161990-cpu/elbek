import { ApplicationError } from './application.error';

/**
 * TASK-AUTH-005 — thrown by `RequestAdminElevationUseCase` when the caller's
 * CURRENT role is not exactly `'admin'` — covers both "already `super_admin`"
 * (§16.10.2's ceiling role, "no further elevation exists") and any other
 * role attempting this specific `admin` -> `super_admin` path. One generic
 * rejection, no distinction between the two reasons.
 */
export class AdminElevationNotEligibleError extends ApplicationError {
  constructor() {
    super('This account is not eligible to request admin elevation.');
  }
}
