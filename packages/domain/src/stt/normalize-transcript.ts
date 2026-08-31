/**
 * TASK-AI-005 (§6.16.3 Data Normalization scope boundary: "cleaning up
 * *extraction artifacts*... before a candidate reaches Chapter 4 — distinct
 * from Chapter 4's *semantic* normalization"). Only presentation-layer
 * cleanup: Unicode NFC normalization and whitespace collapsing. Never
 * rewrites, translates, or reinterprets the transcript's content (BR-INP-004
 * — preprocessing "never rewrites, summarizes, or reinterprets what the
 * source actually says"), and never resolves numeric/date shorthand — that
 * remains exclusively Chapter 4's job (FR-AI-021/022).
 */
export function normalizeTranscript(rawTranscript: string): string {
  return rawTranscript.normalize('NFC').trim().replace(/\s+/g, ' ');
}
