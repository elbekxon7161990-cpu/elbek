import { describe, expect, it } from 'vitest';

import { DEFAULT_IMAGE_VALIDATION_LIMITS, evaluateImageValidity } from './evaluate-image-validity';

function input(overrides: Partial<{ mimeType: string; sizeBytes: number }> = {}) {
  return { mimeType: 'image/jpeg', sizeBytes: 500_000, ...overrides };
}

describe('evaluateImageValidity', () => {
  it('accepts a well-formed JPEG', () => {
    expect(evaluateImageValidity(input())).toEqual({ valid: true });
  });

  it('accepts a well-formed PNG', () => {
    expect(evaluateImageValidity(input({ mimeType: 'image/png' }))).toEqual({ valid: true });
  });

  it('is case-insensitive on MIME type', () => {
    expect(evaluateImageValidity(input({ mimeType: 'IMAGE/JPEG' }))).toEqual({ valid: true });
  });

  it('rejects empty images (0 bytes)', () => {
    expect(evaluateImageValidity(input({ sizeBytes: 0 }))).toEqual({
      valid: false,
      reason: 'EMPTY_IMAGE',
    });
  });

  it('rejects a negative/corrupted size reading', () => {
    expect(evaluateImageValidity(input({ sizeBytes: -1 }))).toEqual({
      valid: false,
      reason: 'EMPTY_IMAGE',
    });
  });

  it('rejects an unsupported MIME type (e.g. a PDF sent as a photo)', () => {
    expect(evaluateImageValidity(input({ mimeType: 'application/pdf' }))).toEqual({
      valid: false,
      reason: 'UNSUPPORTED_FORMAT',
    });
  });

  it("rejects an unsupported image format (e.g. GIF/WEBP, not in FR-OCR-001's JPEG/PNG list)", () => {
    expect(evaluateImageValidity(input({ mimeType: 'image/webp' }))).toEqual({
      valid: false,
      reason: 'UNSUPPORTED_FORMAT',
    });
  });

  it('rejects oversized images (NFR-OCR-003)', () => {
    expect(
      evaluateImageValidity(input({ sizeBytes: DEFAULT_IMAGE_VALIDATION_LIMITS.maxSizeBytes + 1 })),
    ).toEqual({
      valid: false,
      reason: 'OVERSIZED',
    });
  });

  it('accepts an image exactly at the size limit', () => {
    expect(
      evaluateImageValidity(input({ sizeBytes: DEFAULT_IMAGE_VALIDATION_LIMITS.maxSizeBytes })),
    ).toEqual({ valid: true });
  });

  it('checks emptiness before format, reporting only the first failure found', () => {
    expect(evaluateImageValidity(input({ sizeBytes: 0, mimeType: 'video/mp4' }))).toEqual({
      valid: false,
      reason: 'EMPTY_IMAGE',
    });
  });

  it('respects custom limits when provided', () => {
    const result = evaluateImageValidity(input({ sizeBytes: 2_000_000 }), {
      maxSizeBytes: 1_000_000,
    });
    expect(result).toEqual({ valid: false, reason: 'OVERSIZED' });
  });
});
