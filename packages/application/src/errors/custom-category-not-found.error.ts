import { ApplicationError } from './application.error';

/** TASK-FIN-006 — no active custom category matched `id` for the requesting user; never distinguishes "doesn't exist" from "belongs to someone else" (see `CategoryRepository.findCustomCategoryById`'s own doc comment). */
export class CustomCategoryNotFoundError extends ApplicationError {
  constructor(id: string) {
    super(`No active custom category found for id "${id}".`);
  }
}
