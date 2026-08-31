import { ApplicationError } from './application.error';

/** TASK-AUTH-003 (§14.15.4) — malformed scope entry at issuance time. */
export class InvalidApiTokenScopeError extends ApplicationError {
  constructor(scope: string) {
    super(`Invalid scope: "${scope}". Expected "{resource}:{verb}" or "admin:{resource}:{verb}".`);
  }
}
