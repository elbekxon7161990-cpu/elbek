import type { SavingsGoal } from '../entities/savings-goal.entity';

export const SAVINGS_GOAL_REPOSITORY = Symbol('SAVINGS_GOAL_REPOSITORY');

export interface NewSavingsGoalData {
  userId: string;
  name: string;
  targetAmount: string;
  currency: string;
  targetDate: Date | null;
}

/**
 * TASK-FIN-004 (Stage B, Chapter 8 §8.9) — port for the `savings_goals`
 * table (§13.21.2), following the dedicated-repository precedent
 * `DebtRepository`/`LoanRepository` already established.
 *
 * Deliberately scoped to Create + Read only in Stage B — no
 * contribution-recording or milestone/completion-transition method exists
 * yet (`SavingsGoal.evaluateCompletion`/`detectNewlyCrossedGoalMilestones`
 * are pure domain helpers built in Stage A; wiring them against real
 * contribution rows is TASK-FIN-004 Stage F's job, not this port's).
 */
export interface SavingsGoalRepository {
  /** No `userId` parameter — ownership scoping for a single-row read is the RLS policy's own job (same convention `LoanRepository.findById`/`AccountRepository.findById` already establish), enforced by the caller's `runWithUserContext` wrapping. */
  findById(id: string): Promise<SavingsGoal | null>;

  /** Scoped to one user, excludes soft-deleted rows AND `'completed'` goals — the "my active goals" view, mirroring `AccountRepository.findActiveByUserId`'s identical shape. A `'completed'` goal remains findable via `findById` alone, simply excluded from this list. */
  findActiveByUserId(userId: string): Promise<SavingsGoal[]>;

  /** Validates the not-yet-persisted goal (`SavingsGoal.validateNew`) BEFORE any database write, mirroring `LoanRepository.create()`'s own atomic-validation-first discipline. */
  create(data: NewSavingsGoalData): Promise<SavingsGoal>;
}
