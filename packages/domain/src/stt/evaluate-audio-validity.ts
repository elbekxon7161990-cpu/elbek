/**
 * TASK-AI-005 (FR-STT-001, §6.2.4's Duration Guard, FR-INP-060's generic
 * "validate MIME type and size limit before any parsing library" rule) —
 * pure, pre-flight structural validation of a voice message, run BEFORE
 * any bytes are handed to the STT provider. Returns a discriminated result
 * (never throws) — this is a deterministic, always-answerable question
 * ("is this a well-formed Telegram voice message?"), not an exceptional
 * provider failure, so it follows the same "collect and report, don't
 * throw" convention as TASK-AI-001's schema validator.
 *
 * FR-STT-001 scopes accepted input to Telegram voice messages specifically
 * (`.ogg`/Opus) — this does NOT validate a generic "audio file" upload
 * type, since §6.2's functional requirements never describe one; inventing
 * support for arbitrary audio-file uploads beyond what FR-STT-001 states
 * would be scope not grounded in the PRD.
 */
export type AudioValidationFailureReason =
  'EMPTY_AUDIO' | 'UNSUPPORTED_FORMAT' | 'OVERSIZED' | 'DURATION_EXCEEDED';

export type AudioValidationResult =
  { valid: true } | { valid: false; reason: AudioValidationFailureReason };

export interface AudioValidationLimits {
  /** §6.2.4's own illustrative figure ("e.g., 3 minutes") — this task's duration guard, not a Telegram platform limit. */
  maxDurationSeconds: number;
  /** No specific STT byte-size NFR is stated in §6.2; FR-INP-060 mandates *some* size limit exists. A generous default sized for a 3-minute Opus voice note with wide margin. */
  maxSizeBytes: number;
}

export const DEFAULT_AUDIO_VALIDATION_LIMITS: AudioValidationLimits = {
  maxDurationSeconds: 180,
  maxSizeBytes: 20 * 1024 * 1024,
};

/** Telegram voice messages are delivered as Opus-in-OGG; the Bot API reports this MIME type. */
const SUPPORTED_MIME_TYPE_PREFIX = 'audio/ogg';

export function evaluateAudioValidity(
  input: { mimeType: string; sizeBytes: number; durationSeconds: number },
  limits: AudioValidationLimits = DEFAULT_AUDIO_VALIDATION_LIMITS,
): AudioValidationResult {
  if (input.sizeBytes <= 0) {
    return { valid: false, reason: 'EMPTY_AUDIO' };
  }
  if (!input.mimeType.toLowerCase().startsWith(SUPPORTED_MIME_TYPE_PREFIX)) {
    return { valid: false, reason: 'UNSUPPORTED_FORMAT' };
  }
  if (input.sizeBytes > limits.maxSizeBytes) {
    return { valid: false, reason: 'OVERSIZED' };
  }
  if (input.durationSeconds > limits.maxDurationSeconds) {
    return { valid: false, reason: 'DURATION_EXCEEDED' };
  }
  return { valid: true };
}
