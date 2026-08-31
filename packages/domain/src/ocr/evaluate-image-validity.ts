/**
 * TASK-AI-006 (FR-OCR-001, NFR-OCR-003, FR-INP-060's generic "validate
 * MIME type and size limit before any parsing library" rule) — pure,
 * pre-flight structural validation of an uploaded image, run BEFORE any
 * bytes are handed to the OCR provider. Returns a discriminated result
 * (never throws), same "collect and report, don't throw" convention as
 * `evaluate-audio-validity.ts` (TASK-AI-005) and TASK-AI-001's schema
 * validator.
 *
 * FR-OCR-001 scopes accepted input to JPEG/PNG photo uploads (Telegram's
 * compressed photo delivery and original-quality document uploads) —
 * pixel-dimension validation is deliberately not implemented: no NFR or
 * FR anywhere in Chapter 6 states a minimum/maximum dimension, only a
 * file-size ceiling (NFR-OCR-003); inventing an unstated dimension rule
 * would not be grounded in the PRD.
 */
export type ImageValidationFailureReason = 'EMPTY_IMAGE' | 'UNSUPPORTED_FORMAT' | 'OVERSIZED';

export type ImageValidationResult =
  { valid: true } | { valid: false; reason: ImageValidationFailureReason };

export interface ImageValidationLimits {
  /** NFR-OCR-003's own default ("Configurable, default 20MB"). */
  maxSizeBytes: number;
}

export const DEFAULT_IMAGE_VALIDATION_LIMITS: ImageValidationLimits = {
  maxSizeBytes: 20 * 1024 * 1024,
};

/** FR-OCR-001: "photo uploads (JPEG/PNG...)". */
const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png'];

export function evaluateImageValidity(
  input: { mimeType: string; sizeBytes: number },
  limits: ImageValidationLimits = DEFAULT_IMAGE_VALIDATION_LIMITS,
): ImageValidationResult {
  if (input.sizeBytes <= 0) {
    return { valid: false, reason: 'EMPTY_IMAGE' };
  }
  if (!SUPPORTED_MIME_TYPES.includes(input.mimeType.toLowerCase())) {
    return { valid: false, reason: 'UNSUPPORTED_FORMAT' };
  }
  if (input.sizeBytes > limits.maxSizeBytes) {
    return { valid: false, reason: 'OVERSIZED' };
  }
  return { valid: true };
}
