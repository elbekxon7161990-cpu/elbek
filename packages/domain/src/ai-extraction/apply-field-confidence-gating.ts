import type { TransactionExtractionCandidate } from './transaction-extraction-schema';

/**
 * TASK-AI-003 (Chapter 4 §4.8 layer 4 "Confidence gating"; §4.6.1's Low
 * band: "Field left null/unset ... the primary functional safeguard: even
 * if the model does produce an ungrounded guess, low self-reported
 * confidence routes it to user clarification rather than direct commit.")
 *
 * Distinct from TASK-AI-002's `applyIntentConfidenceThreshold` (FR-AI-013),
 * which gates only the `intent` field and forces the whole candidate to
 * `UNKNOWN`. This gates every *other* nullable extracted field
 * independently, per §4.6.1's per-field banding — a candidate can keep its
 * intent while individual low-confidence fields (e.g. a shaky `category`
 * guess) are nulled out on their own.
 */

const LOW_CONFIDENCE_THRESHOLD = 0.6;

const GATED_FIELDS = [
  'amount',
  'currency',
  'category',
  'subcategory',
  'merchant',
  'paymentMethod',
  'transactionDate',
  'transactionTime',
  'location',
  'counterparty',
  'dueDate',
] as const;

export interface FieldConfidenceGatingResult {
  candidate: TransactionExtractionCandidate;
  /** Field names nulled because their reported confidence fell in the Low band (< 0.6). */
  gatedFields: readonly string[];
}

export function applyFieldConfidenceGating(
  candidate: TransactionExtractionCandidate,
): FieldConfidenceGatingResult {
  const gatedFields: string[] = [];
  const patch: Partial<TransactionExtractionCandidate> = {};

  for (const field of GATED_FIELDS) {
    const value = candidate[field];
    if (value === null) {
      continue;
    }
    const score = candidate.confidenceScores[field];
    if (typeof score === 'number' && score < LOW_CONFIDENCE_THRESHOLD) {
      gatedFields.push(field);
      (patch as Record<string, unknown>)[field] = null;
    }
  }

  return {
    candidate: gatedFields.length === 0 ? candidate : { ...candidate, ...patch },
    gatedFields,
  };
}
