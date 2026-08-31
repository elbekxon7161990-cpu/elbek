import {
  CATEGORY_REQUIRED_INTENTS,
  COUNTERPARTY_REQUIRED_INTENTS,
  FINANCIAL_INTENTS,
} from './transaction-extraction-schema';
import type { AiIntent } from './transaction-extraction-schema';
import type { TransactionExtractionCandidate } from './transaction-extraction-schema';

/**
 * TASK-AI-003 (Chapter 4 §4.6.2 "Overall Record Confidence") — "computed as
 * the minimum of required-field confidences, not an average, since a
 * single critical low-confidence field ... should not be masked by high
 * confidence on optional fields."
 *
 * "Required fields" here means the same conditional-requiredness rules
 * `transaction-extraction-schema.ts`/AI-001's validator already define for
 * this candidate's intent (`FINANCIAL_INTENTS`/`CATEGORY_REQUIRED_INTENTS`/
 * `COUNTERPARTY_REQUIRED_INTENTS`) plus `intent`, which is unconditionally
 * required for every candidate. `description` is unconditionally required
 * too (§4.4.1), but — per §4.5.3's own worked JSON example, whose
 * `confidence_scores` object lists only `intent`/`amount`/`currency`/
 * `category`/`transaction_date` — the model is never asked to report a
 * confidence score *for* `description` itself, so it is excluded from this
 * computation rather than always contributing a spurious 0.
 *
 * A required field that is null after upstream filtering (grounding /
 * per-field confidence gating / sanity bounds) contributes 0, regardless
 * of what its originally-reported score was — a required field with no
 * value is a certainty problem by definition, independent of *why* it
 * ended up null (AI-P6, fail closed).
 */
/**
 * The same conditional-requiredness rule set this file's own header comment
 * describes, factored out so `computeRecordConfidence` and
 * `selectFirstMissingRequiredField` (TASK-BOT-001) share one definition of
 * "required" rather than each re-deriving it.
 */
/**
 * TASK-MVP-001 — reconciles a genuine, PRD-internal disagreement discovered
 * by TASK-FIN-REAL-001: Chapter 4 §4.4.1's field table marks `category`
 * required "Yes for EXPENSE/INCOME" only (`CATEGORY_REQUIRED_INTENTS`,
 * above — the AI's own *output contract*, still exactly what
 * `structured-output-validator.ts`/TASK-AI-001 enforces, unchanged), but
 * Chapter 13 §13.4 declares `transactions.category_id` `NOT NULL`
 * unconditionally, for every transaction type without exception —
 * including `SALARY`/`REFUND`. The taxonomy itself already seeds a
 * `SALARY` category (`income`-typed) precisely for this case, confirming
 * the omission is a gap in §4.4.1's table, not a deliberate "no category
 * ever" design for these two types.
 *
 * This is deliberately a *second*, commit-readiness-specific constant, not
 * a widening of `CATEGORY_REQUIRED_INTENTS` itself — that constant governs
 * "did the model follow its own output contract" (schema validity), a
 * different, still-valid question from "is this record complete enough to
 * safely persist" (record confidence, this file's own job). Widening
 * `CATEGORY_REQUIRED_INTENTS` would make TASK-AI-001's validator start
 * schema-*rejecting* a SALARY/REFUND candidate the model correctly
 * produced per its actual instructions — the wrong failure mode for what
 * is a completeness gap, not a malformed response.
 *
 * Effect: a `SALARY`/`REFUND` candidate with no category now scores 0 on
 * this required field, same as a missing `amount`/`currency` already does
 * — `classifyRecordConfidence` returns `draft_pending_clarification`
 * instead of `auto_commit`/`flagged_review`, so the Conversation Engine
 * (TASK-BOT-002) asks the user for a category *before* `commitRequested`
 * can ever be set — `TransactionCommitAdapter`'s own
 * `IncompleteTransactionCandidateError('category')` guard (TASK-FIN-REAL-001)
 * remains defense-in-depth only, exactly as it already was for
 * amount/currency/transactionDate, now provably unreachable for every
 * intent this system can actually commit.
 */
const CATEGORY_REQUIRED_FOR_COMMIT_INTENTS: readonly AiIntent[] = [
  ...CATEGORY_REQUIRED_INTENTS,
  'SALARY',
  'REFUND',
];

export function computeRequiredFields(
  candidate: TransactionExtractionCandidate,
): readonly string[] {
  const requiredFields: string[] = ['intent'];

  if (FINANCIAL_INTENTS.includes(candidate.intent)) {
    requiredFields.push('amount', 'currency', 'transactionDate');
  }
  if (CATEGORY_REQUIRED_FOR_COMMIT_INTENTS.includes(candidate.intent)) {
    requiredFields.push('category');
  }
  if (COUNTERPARTY_REQUIRED_INTENTS.includes(candidate.intent)) {
    requiredFields.push('counterparty');
  }

  return requiredFields;
}

export function computeRecordConfidence(candidate: TransactionExtractionCandidate): number {
  const requiredFields = computeRequiredFields(candidate);

  const scores = requiredFields.map((field) => {
    const value = (candidate as unknown as Record<string, unknown>)[field];
    if (value === null) {
      return 0;
    }
    const reported = candidate.confidenceScores[field];
    return typeof reported === 'number' ? reported : 0;
  });

  return Math.min(...scores);
}

export type RecordConfidenceClassification =
  'auto_commit' | 'flagged_review' | 'draft_pending_clarification';

/** §4.6.2's exact three-way outcome bands. */
export function classifyRecordConfidence(recordConfidence: number): RecordConfidenceClassification {
  if (recordConfidence >= 0.85) {
    return 'auto_commit';
  }
  if (recordConfidence >= 0.6) {
    return 'flagged_review';
  }
  return 'draft_pending_clarification';
}
