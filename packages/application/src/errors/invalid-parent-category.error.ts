import { ApplicationError } from './application.error';

/** BR-SET-001 — a custom category's chosen parent must be an existing, active SYSTEM category. */
export class InvalidParentCategoryError extends ApplicationError {
  constructor(code: string) {
    super(`"${code}" is not a valid parent category.`);
  }
}
