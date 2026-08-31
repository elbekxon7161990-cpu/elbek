import type { TransactionExtractionCandidate } from './transaction-extraction-schema';

/**
 * TASK-AI-003 (Chapter 4 §4.8 layer 3 "Grounding requirement"; BR-AI-002;
 * the "Grounding Validator" logical component, §4.13.1) — checks that
 * `merchant`, `location`, and `counterparty` (the exact three fields
 * FR-AI-024 names as forbidden-to-fabricate) are textually supported by the
 * raw input text, per AI-P3 ("a field with no textual support is null,
 * regardless of how plausible a guess might be").
 *
 * `amount`/`currency`/`category`/`transactionDate` are deliberately NOT
 * checked here — those fields are expected to diverge from their literal
 * source span by design (normalization: "50 ming" -> 50000; inference:
 * merchant knowledge -> a category code), so a literal-text grounding check
 * would misfire on legitimate extractions. FR-AI-024 itself scopes the
 * anti-fabrication hard rule to exactly these three free-text fields.
 *
 * This is a deterministic, conservative heuristic — a real semantic
 * grounding check needs the model itself (§4.8's own framing: this is a
 * defense-in-depth *mitigation*, not a claim of perfect hallucination
 * detection). A field is considered grounded if any token of length >= 3
 * from its value appears, case/diacritic-insensitively, as a substring of
 * the normalized input text; shorter values fall back to a whole-value
 * substring check.
 */

const MIN_SIGNIFICANT_TOKEN_LENGTH = 3;

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''); // strip diacritics so "Yoqilg'i"/"Yoqilgi"-style variants still match
}

function isGrounded(value: string, normalizedInputText: string): boolean {
  const normalizedValue = normalize(value);
  const tokens = normalizedValue
    .split(/\s+/)
    .filter((token) => token.length >= MIN_SIGNIFICANT_TOKEN_LENGTH);

  if (tokens.length === 0) {
    return normalizedInputText.includes(normalizedValue);
  }

  return tokens.some((token) => normalizedInputText.includes(token));
}

const GROUNDING_CHECKED_FIELDS = ['merchant', 'location', 'counterparty'] as const;

export interface GroundingResult {
  candidate: TransactionExtractionCandidate;
  /** Field names nulled because they had no textual support in the input (potential fabrication, FR-AI-024). */
  ungroundedFields: readonly string[];
}

export function evaluateFieldGrounding(
  candidate: TransactionExtractionCandidate,
  inputText: string,
): GroundingResult {
  const normalizedInputText = normalize(inputText);
  const ungroundedFields: string[] = [];
  const patch: Partial<TransactionExtractionCandidate> = {};

  for (const field of GROUNDING_CHECKED_FIELDS) {
    const value = candidate[field];
    if (typeof value === 'string' && value.length > 0 && !isGrounded(value, normalizedInputText)) {
      ungroundedFields.push(field);
      patch[field] = null;
    }
  }

  return {
    candidate: ungroundedFields.length === 0 ? candidate : { ...candidate, ...patch },
    ungroundedFields,
  };
}
