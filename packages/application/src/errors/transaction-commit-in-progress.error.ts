import { ApplicationError } from './application.error';

/** TASK-FIN-REAL-001 — a concurrent caller already claimed this draft's idempotency lock and hasn't finished (or failed without releasing it within the lock TTL). The caller should treat this as transient, not retry-forever. */
export class TransactionCommitInProgressError extends ApplicationError {
  constructor(draftId: string) {
    super(`A commit for draft "${draftId}" is already in progress.`);
  }
}
