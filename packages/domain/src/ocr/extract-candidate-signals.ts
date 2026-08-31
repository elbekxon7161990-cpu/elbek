/**
 * TASK-AI-006 (§6.17 Extraction Support Functions) — deliberately produces
 * only *candidate* signals, never a final decision:
 *
 * - FR-INP-040: "detect common currency symbols and codes... surface them
 *   as a candidate signal alongside the extracted amount, without itself
 *   deciding the final currency (that remains Chapter 4's responsibility)."
 * - FR-INP-043: "extract the most likely merchant-name candidate... typically
 *   the most prominent header text... pass it to Chapter 4 as a candidate
 *   `merchant` value with its own confidence signal, distinct from Chapter
 *   4's own confidence in category inference."
 *
 * §6.17.4's scope boundary statement applies here without qualification:
 * this module performs no category inference and no final currency/
 * merchant decision — it supplies raw candidate signal only. The
 * authoritative extraction still happens by feeding the OCR text itself
 * into the existing `ExtractTransactionCandidatesUseCase` (TASK-AI-002),
 * unchanged; these candidates are informational metadata attached to the
 * structured OCR result, not a second extraction path (ADR-INP-001).
 *
 * Date-format candidate detection (also named in §6.17.2) is deliberately
 * NOT implemented here — FR-INP-042 explicitly scopes it to the date-
 * format enumeration FR-XLS-005 defines (a different, not-yet-built task's
 * territory); inventing a second, un-enumerated date-format list here
 * would not be grounded in the PRD.
 */

/** A representative, non-exhaustive set of symbols/codes explicitly named in FR-INP-040's own example list ("so'm", "UZS", "$", "USD", "₽", "RUB") plus the other ISO codes already seeded in this system (EUR — see `packages/infrastructure/prisma/seed.ts`). */
const CURRENCY_PATTERNS: readonly { pattern: RegExp; candidate: string }[] = [
  { pattern: /\bUZS\b/i, candidate: 'UZS' },
  { pattern: /so'?m/i, candidate: 'UZS' },
  { pattern: /\bUSD\b/i, candidate: 'USD' },
  { pattern: /\$/, candidate: 'USD' },
  { pattern: /\bRUB\b/i, candidate: 'RUB' },
  { pattern: /₽/, candidate: 'RUB' },
  { pattern: /\bEUR\b/i, candidate: 'EUR' },
  { pattern: /€/, candidate: 'EUR' },
];

export function detectCurrencyCandidates(text: string): readonly string[] {
  const found = new Set<string>();
  for (const { pattern, candidate } of CURRENCY_PATTERNS) {
    if (pattern.test(text)) {
      found.add(candidate);
    }
  }
  return [...found];
}

/**
 * "Typically the most prominent text near the top of a receipt" (§6.3.3) —
 * approximated, in the absence of any provider-supplied layout/bounding-
 * box data, as the first non-empty line of the (already normalized) OCR
 * text. A best-effort heuristic, not a claim of semantic correctness —
 * Chapter 4's own extraction is still the authoritative source for the
 * final `merchant` field.
 */
export function detectMerchantCandidate(normalizedText: string): string | null {
  const firstLine = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine ?? null;
}
