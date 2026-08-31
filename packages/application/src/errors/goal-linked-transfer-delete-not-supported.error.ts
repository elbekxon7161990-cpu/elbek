import { ApplicationError } from './application.error';

/**
 * TASK-FIN-004 (FR-FIN-006) — thrown by `DeleteTransactionUseCase` for a
 * TRANSFER that also contributes to a `SavingsGoal` (the FR-FIN-012 "linked
 * transfer" mode). No mechanism exists yet to reverse/reconcile the goal's
 * progress/milestone state against a deleted contribution, so deletion is
 * rejected outright rather than silently leaving that state stale.
 */
export class GoalLinkedTransferDeleteNotSupportedError extends ApplicationError {
  constructor(transactionId: string) {
    super(
      `Cannot delete goal-linked TRANSFER "${transactionId}"; deleting a transfer that also contributes to a savings goal is not supported.`,
    );
  }
}
