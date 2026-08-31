import { describe, expect, it } from 'vitest';

import { DEFAULT_AUDIO_VALIDATION_LIMITS, evaluateAudioValidity } from './evaluate-audio-validity';

function input(
  overrides: Partial<{ mimeType: string; sizeBytes: number; durationSeconds: number }> = {},
) {
  return { mimeType: 'audio/ogg', sizeBytes: 500_000, durationSeconds: 30, ...overrides };
}

describe('evaluateAudioValidity', () => {
  it('accepts a well-formed Telegram voice message', () => {
    expect(evaluateAudioValidity(input())).toEqual({ valid: true });
  });

  it('accepts a MIME type with codec parameters (e.g. "audio/ogg; codecs=opus")', () => {
    expect(evaluateAudioValidity(input({ mimeType: 'audio/ogg; codecs=opus' }))).toEqual({
      valid: true,
    });
  });

  it('is case-insensitive on MIME type', () => {
    expect(evaluateAudioValidity(input({ mimeType: 'AUDIO/OGG' }))).toEqual({ valid: true });
  });

  it('rejects empty audio (0 bytes)', () => {
    expect(evaluateAudioValidity(input({ sizeBytes: 0 }))).toEqual({
      valid: false,
      reason: 'EMPTY_AUDIO',
    });
  });

  it('rejects a negative/corrupted size reading', () => {
    expect(evaluateAudioValidity(input({ sizeBytes: -1 }))).toEqual({
      valid: false,
      reason: 'EMPTY_AUDIO',
    });
  });

  it('rejects an unsupported MIME type (not Telegram voice format)', () => {
    expect(evaluateAudioValidity(input({ mimeType: 'audio/mpeg' }))).toEqual({
      valid: false,
      reason: 'UNSUPPORTED_FORMAT',
    });
  });

  it('rejects a non-audio MIME type entirely', () => {
    expect(evaluateAudioValidity(input({ mimeType: 'image/jpeg' }))).toEqual({
      valid: false,
      reason: 'UNSUPPORTED_FORMAT',
    });
  });

  it('rejects oversized audio', () => {
    expect(
      evaluateAudioValidity(input({ sizeBytes: DEFAULT_AUDIO_VALIDATION_LIMITS.maxSizeBytes + 1 })),
    ).toEqual({
      valid: false,
      reason: 'OVERSIZED',
    });
  });

  it('accepts audio exactly at the size limit', () => {
    expect(
      evaluateAudioValidity(input({ sizeBytes: DEFAULT_AUDIO_VALIDATION_LIMITS.maxSizeBytes })),
    ).toEqual({ valid: true });
  });

  it('rejects audio exceeding the duration guard (§6.2.4)', () => {
    expect(
      evaluateAudioValidity(
        input({ durationSeconds: DEFAULT_AUDIO_VALIDATION_LIMITS.maxDurationSeconds + 1 }),
      ),
    ).toEqual({
      valid: false,
      reason: 'DURATION_EXCEEDED',
    });
  });

  it('accepts audio exactly at the duration limit', () => {
    expect(
      evaluateAudioValidity(
        input({ durationSeconds: DEFAULT_AUDIO_VALIDATION_LIMITS.maxDurationSeconds }),
      ),
    ).toEqual({ valid: true });
  });

  it('checks size before format, and format before duration, but reports only the first failure found (empty audio wins over an also-bad MIME type)', () => {
    expect(evaluateAudioValidity(input({ sizeBytes: 0, mimeType: 'video/mp4' }))).toEqual({
      valid: false,
      reason: 'EMPTY_AUDIO',
    });
  });

  it('respects custom limits when provided', () => {
    const result = evaluateAudioValidity(input({ durationSeconds: 10 }), {
      maxDurationSeconds: 5,
      maxSizeBytes: 1_000_000,
    });
    expect(result).toEqual({ valid: false, reason: 'DURATION_EXCEEDED' });
  });
});
