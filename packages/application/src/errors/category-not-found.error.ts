import { ApplicationError } from './application.error';

/** TASK-FIN-REAL-001 — `CategoryRepository.findByCode` found no active category for the candidate's code (a code the AI extraction pipeline invented, or a taxonomy drift between the prompt template and the seeded categories table). */
export class CategoryNotFoundError extends ApplicationError {
  constructor(code: string) {
    super(`No active category found for code "${code}".`);
  }
}
