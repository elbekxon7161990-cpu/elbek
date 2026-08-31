import { ApplicationError } from './application.error';

/** BR-EXP-001 — a transaction must reference an existing, non-deprecated category. */
export class InvalidCategoryError extends ApplicationError {
  constructor(categoryId: string) {
    super(`Invalid or unavailable category: "${categoryId}".`);
  }
}
