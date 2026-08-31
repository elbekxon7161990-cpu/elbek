import { ApplicationError } from './application.error';

/** TASK-AUTH-003 — admin-triggered revoke of a nonexistent token id. Admin-only surface, safe to be specific (no external-facing enumeration concern). */
export class ApiTokenNotFoundError extends ApplicationError {
  constructor(id: string) {
    super(`API token not found: "${id}".`);
  }
}
