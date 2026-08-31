import { computeRequiredFields } from '../ai-extraction/compute-record-confidence';
import type { TransactionExtractionCandidate } from '../ai-extraction/transaction-extraction-schema';

/**
 * TASK-BOT-003 (Chapter 5 §5.14 "Clarification Question Prioritization
 * Algorithm") — replaces TASK-BOT-001's `selectFirstMissingRequiredField`
 * placeholder (see that file's own doc comment: "this is explicitly a
 * placeholder, not TASK-BOT-003's prioritization algorithm"). Implements
 * §5.14.2's flowchart exactly: intent-disambiguation > amount > counterparty
 * (DEBT_* / TRANSFER) > category > any other required field, per FR-CE-002's
 * stated order.
 *
 * §5.14's flowchart already collapses "missing" and "low-confidence" into
 * one check ("Is amount missing OR low-confidence?") — this function does
 * not need to separately test confidence scores itself, because
 * TASK-AI-003's `applyFieldConfidenceGating` (Chapter 4 §4.8 Layer 4, Low
 * band < 0.6) already nulls out any required field whose reported
 * confidence fell below the threshold *before* a candidate ever reaches
 * this function — by the time a candidate is routed here, "missing" and
 * "was low-confidence" are both represented identically as `null`. Testing
 * `=== null` is therefore both necessary and sufficient; it is not a
 * simplification that skips the low-confidence case.
 *
 * Reuses `computeRequiredFields` (TASK-AI-003) as the single source of
 * truth for "which fields does this candidate's intent actually require to
 * commit" rather than re-deriving that per-intent logic here — this
 * function only orders and selects among what that function already says
 * is required.
 *
 * DISCOVERED PRD AMBIGUITY (reported, not silently resolved): §5.14.2's
 * flowchart parenthetically scopes the category check to "(EXPENSE/INCOME
 * only)", matching Chapter 4 §4.4.1's original table. TASK-MVP-001 later
 * discovered and fixed a genuine PRD-internal gap: Chapter 13 §13.4's
 * `category_id NOT NULL` also requires a category for `SALARY`/`REFUND` to
 * ever commit (see `compute-record-confidence.ts`'s own
 * `CATEGORY_REQUIRED_FOR_COMMIT_INTENTS`). §5.14's parenthetical was not
 * revisited when that fix landed. This function follows
 * `computeRequiredFields`'s already-corrected required-field set (i.e.
 * treats category as required, and therefore prioritized in the same
 * "category" slot, for SALARY/REFUND too) rather than the flowchart's
 * literal, now-stale "(EXPENSE/INCOME only)" text — the alternative
 * (restricting the dedicated category slot to EXPENSE/INCOME only) would
 * not skip asking about category for SALARY/REFUND, since it would still
 * be required and still `null`; it would only demote it to the "any other
 * required field" catch-all, where it could be asked about *after*
 * `currency`/`transactionDate` — the opposite of §5.14's own stated
 * rationale that category outranks "date, other" ([Chapter 5 §5.14.3]).
 * Treating the flowchart's EXPENSE/INCOME parenthetical as stale
 * documentation (not a deliberate, still-intended restriction) is the
 * reading consistent with keeping the *rest* of §5.14.3's rationale table
 * intact.
 *
 * `null` return value means the intent itself is ambiguous (`UNKNOWN`,
 * already downgraded by `applyIntentConfidenceThreshold` upstream) rather
 * than a specific field — the same convention `AwaitingClarificationContext.missingField`
 * already documents.
 */
export function selectClarificationField(candidate: TransactionExtractionCandidate): string | null {
  if (candidate.intent === 'UNKNOWN') {
    return null;
  }

  const requiredFields = computeRequiredFields(candidate);
  const record = candidate as unknown as Record<string, unknown>;
  const isMissing = (field: string): boolean =>
    requiredFields.includes(field) && (record[field] === null || record[field] === undefined);

  if (isMissing('amount')) {
    return 'amount';
  }
  if (isMissing('counterparty')) {
    return 'counterparty';
  }
  if (isMissing('category')) {
    return 'category';
  }

  const other = requiredFields.find(
    (field) =>
      field !== 'intent' &&
      field !== 'amount' &&
      field !== 'counterparty' &&
      field !== 'category' &&
      (record[field] === null || record[field] === undefined),
  );
  return other ?? null;
}
