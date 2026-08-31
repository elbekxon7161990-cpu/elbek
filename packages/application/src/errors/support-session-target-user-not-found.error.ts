import { ApplicationError } from './application.error';

/** TASK-SEC-006 — thrown when a support session is opened against a non-existent target user id. */
export class SupportSessionTargetUserNotFoundError extends ApplicationError {
  constructor() {
    super('Target user not found.');
  }
}
