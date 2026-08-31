import { ApplicationError } from './application.error';

/** TASK-AUTH-002 Decision 4 — bootstrap fails safe rather than silently overwriting an existing admin's credentials. */
export class AdminAlreadyExistsError extends ApplicationError {
  constructor(email: string) {
    super(`Admin already exists: "${email}".`);
  }
}
