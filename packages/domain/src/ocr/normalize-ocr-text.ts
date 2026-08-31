/**
 * TASK-AI-006 (§6.16.3 Data Normalization: "Common OCR misread correction
 * (e.g., 'O' vs '0', 'l' vs '1' in numeric contexts) | OCR-sourced text").
 *
 * Two steps, both presentation-layer-only per BR-INP-004 ("preprocessing
 * never rewrites, summarizes, or reinterprets what the source actually
 * says"):
 * 1. Unicode NFC normalization + whitespace/line-break collapsing —
 *    identical in spirit to `normalize-transcript.ts` (TASK-AI-005),
 *    generalized here to also collapse OCR's characteristic multi-blank-
 *    line layout artifacts.
 * 2. Digit-context misread correction — ONLY applied within a token that
 *    is otherwise entirely digits (e.g. "1O0" -> "100"); a token
 *    containing real letters (e.g. "Lunch") is never touched. This is
 *    deliberately conservative: correcting a manifest OCR character-
 *    recognition artifact within a numeric run is presentation-layer
 *    cleanup, but "helpfully" reinterpreting an ambiguous whole word would
 *    cross into the semantic rewriting BR-INP-004 forbids.
 */
function correctDigitContextMisreads(token: string): string {
  const digitLikeChars = /^[0-9OolI]+$/;
  if (!digitLikeChars.test(token) || !/[0-9]/.test(token)) {
    return token;
  }
  return token.replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
}

export function normalizeOcrText(rawText: string): string {
  const whitespaceNormalized = rawText
    .normalize('NFC')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return whitespaceNormalized
    .split(/(\s+)/)
    .map((chunk) => (/\s/.test(chunk) ? chunk : correctDigitContextMisreads(chunk)))
    .join('');
}
