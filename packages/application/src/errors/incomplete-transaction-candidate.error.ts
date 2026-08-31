import { ApplicationError } from './application.error';

/**
 * TASK-FIN-REAL-001 — defense-in-depth only. TASK-BOT-002's guard table
 * only sets `commitRequested: true` for `auto_commit`/`flagged_review`
 * classifications, and `computeRecordConfidence` (TASK-AI-003) scores a
 * null required field as 0 — which always yields `draft_pending_clarification`,
 * never auto_commit/flagged_review. A null value here should therefore be
 * structurally unreachable; this error exists so a violation of that
 * invariant fails loudly (AI-P6, "fail closed") instead of silently
 * committing a malformed row.
 *
 * TASK-MVP-001 closed the one gap that used to make `category` a *real*,
 * reachable case here: `computeRecordConfidence` now also requires
 * `category` for `SALARY`/`REFUND` (`CATEGORY_REQUIRED_FOR_COMMIT_INTENTS`,
 * `compute-record-confidence.ts`) — reconciling Chapter 4 §4.4.1's
 * per-intent AI output contract (still EXPENSE/INCOME-only, unchanged,
 * still enforced by TASK-AI-001's schema validator) against Chapter 13
 * §13.4's unconditional `category_id NOT NULL`. `category` is therefore
 * now unreachable-as-null here for every intent this system can actually
 * commit, the same as amount/currency/transactionDate always were.
 */
export class IncompleteTransactionCandidateError extends ApplicationError {
  constructor(missingField: string) {
    super(`Cannot commit: candidate is missing required field "${missingField}".`);
  }
}
