/**
 * TASK-AI-006 (OCR real-boot follow-up) — real Claude Vision receipt reads
 * naturally report a printed time as `HH:MM` (a receipt's clock stamp never
 * prints seconds); `structured-output-validator.ts`'s own `transactionTime`
 * contract has always been strict `HH:MM:SS`, which rejected every real
 * Claude Vision extraction that included a time at all. Normalizes at the
 * validation boundary (not the extraction prompt) so both the LLM/OCR
 * contract and the stored data shape stay exactly `HH:MM:SS`, matching this
 * module's existing pattern of small, single-purpose, directly-testable
 * `normalize*` functions (`normalize-ocr-text.ts`, `normalize-transaction-input.ts`).
 *
 * Deliberately narrow: only fills in `:00` seconds for an otherwise
 * strictly-formed two-digit `HH:MM`. Anything else (missing leading zeros,
 * an out-of-range hour/minute, extra segments, non-numeric input) is left
 * for the caller's own existing `HH:MM:SS` check to reject — this function
 * never invents a "best guess," it only recognizes the one specific shape
 * real Claude Vision output is missing seconds from.
 */
const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HH_MM_SS_PATTERN = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

/**
 * Returns `value` unchanged if it is already a valid `HH:MM:SS` time,
 * `${value}:00` if it is a valid `HH:MM` time (seconds defaulted to `00`
 * per FR-OCR's own "seconds unknown -> 00" rule), or `null` if `value` is
 * neither — the caller decides how to report that as a validation issue.
 */
export function normalizeTransactionTime(value: string): string | null {
  if (HH_MM_SS_PATTERN.test(value)) {
    return value;
  }
  if (HH_MM_PATTERN.test(value)) {
    return `${value}:00`;
  }
  return null;
}
