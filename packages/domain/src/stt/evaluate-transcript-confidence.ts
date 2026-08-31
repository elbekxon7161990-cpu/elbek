/**
 * FR-STT-005 — "If transcription confidence is low (below provider-reported
 * or system-computed threshold), the bot must show the transcript to the
 * user for confirmation before proceeding to extraction... rather than
 * silently acting on a likely-wrong transcript." §6.2 does not state a
 * specific numeric threshold beyond this qualitative rule, so this reuses
 * the same 0.6 Low-confidence boundary already established and documented
 * for exactly this purpose at §4.6.1/FR-AI-013 (TASK-AI-002/003), rather
 * than inventing an unstated second threshold value for what is the same
 * "Low confidence degrades to the user, never to a guess" principle
 * (INP-P3) applied to a different signal.
 */
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.6;

export function transcriptRequiresConfirmation(
  sttConfidence: number,
  threshold: number = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
): boolean {
  return sttConfidence < threshold;
}
