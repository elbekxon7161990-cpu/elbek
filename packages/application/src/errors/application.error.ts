/**
 * Base for every application-layer error (TASK-FIN-001 Part 2). Never an
 * infrastructure error (Prisma, etc.) — those are translated at the
 * infrastructure boundary, never surfaced through this hierarchy.
 */
export abstract class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
