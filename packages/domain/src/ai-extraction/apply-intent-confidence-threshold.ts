import type {
  StructuredExtractionOutput,
  TransactionExtractionCandidate,
} from './transaction-extraction-schema';

const DEFAULT_INTENT_CONFIDENCE_THRESHOLD = 0.6;

/**
 * FR-AI-013 (§4.3.2) — "When intent confidence is below the configured
 * threshold (default 0.6 ... ), the system must classify as UNKNOWN and
 * trigger the clarification flow rather than force a low-confidence guess
 * into a domain service." This is that classification step (§4.3.3's flow:
 * C -> E). *Triggering* the clarification flow itself is Chapter 5's job
 * (out of this task's scope) — this function's only responsibility is to
 * compute the correct `intent`/`clarificationNeeded`/`clarificationQuestion`
 * signal on the already schema-validated output, per AI-P6 (fail closed to
 * clarification, never fail open to guessing).
 *
 * A candidate whose `confidenceScores.intent` is missing entirely is also
 * treated as failing the threshold (AI-P6 — fail closed on missing data,
 * never assume confidence that was never reported).
 *
 * Does not re-run `validateStructuredExtractionOutput` — this operates on
 * an already-validated `StructuredExtractionOutput` and produces another
 * structurally-valid one (UNKNOWN candidates get their financial/
 * conditionally-required fields nulled to stay consistent with
 * `transaction-extraction-schema.ts`'s own conditional-requiredness rules).
 */
export function applyIntentConfidenceThreshold(
  output: StructuredExtractionOutput,
  threshold: number = DEFAULT_INTENT_CONFIDENCE_THRESHOLD,
): StructuredExtractionOutput {
  let anyDowngraded = false;

  const transactions = output.transactions.map((candidate) => {
    const intentConfidence = candidate.confidenceScores.intent;
    const failsThreshold = typeof intentConfidence !== 'number' || intentConfidence < threshold;

    if (!failsThreshold || candidate.intent === 'UNKNOWN') {
      return candidate;
    }

    anyDowngraded = true;
    return downgradeToUnknown(candidate);
  });

  if (!anyDowngraded) {
    return output;
  }

  return {
    ...output,
    transactions,
    clarificationNeeded: true,
    clarificationQuestion:
      output.clarificationQuestion ??
      "I'm not sure I understood that correctly — could you rephrase it?",
  };
}

/**
 * `UNKNOWN` is not a member of `FINANCIAL_INTENTS`/`CATEGORY_REQUIRED_INTENTS`/
 * `COUNTERPARTY_REQUIRED_INTENTS` (`transaction-extraction-schema.ts`), so a
 * candidate downgraded to `UNKNOWN` must null every conditionally-required
 * field to stay internally consistent with that schema's own rules.
 */
function downgradeToUnknown(
  candidate: TransactionExtractionCandidate,
): TransactionExtractionCandidate {
  return {
    ...candidate,
    intent: 'UNKNOWN',
    amount: null,
    currency: null,
    transactionDate: null,
    category: null,
    counterparty: null,
  };
}
