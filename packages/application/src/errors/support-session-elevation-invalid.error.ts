import { ApplicationError } from './application.error';

/**
 * TASK-SEC-006 — thrown for every reason an elevation-approval attempt is
 * rejected: unknown/expired/already-resolved request, the approver being
 * the session's own agent (self-elevation), the approver not being a
 * super_admin, or a lost atomic-consume race. One error, one generic
 * outward rejection — no distinguishing shape.
 */
export class SupportSessionElevationInvalidError extends ApplicationError {
  constructor() {
    super('This elevation request cannot be approved.');
  }
}
