import { describe, expect, it } from 'vitest';

import { transcriptRequiresConfirmation } from './evaluate-transcript-confidence';

describe('transcriptRequiresConfirmation (FR-STT-005)', () => {
  it('does not require confirmation for high confidence (AC-INP-001)', () => {
    expect(transcriptRequiresConfirmation(0.95)).toBe(false);
  });

  it('does not require confirmation exactly at the threshold (0.6 is not Low)', () => {
    expect(transcriptRequiresConfirmation(0.6)).toBe(false);
  });

  it('requires confirmation just below the threshold', () => {
    expect(transcriptRequiresConfirmation(0.59)).toBe(true);
  });

  it('requires confirmation for a very low confidence score', () => {
    expect(transcriptRequiresConfirmation(0.1)).toBe(true);
  });

  it('requires confirmation for 0.0 confidence', () => {
    expect(transcriptRequiresConfirmation(0)).toBe(true);
  });

  it('does not require confirmation for 1.0 confidence', () => {
    expect(transcriptRequiresConfirmation(1)).toBe(false);
  });

  it('respects a custom threshold', () => {
    expect(transcriptRequiresConfirmation(0.7, 0.8)).toBe(true);
    expect(transcriptRequiresConfirmation(0.85, 0.8)).toBe(false);
  });
});
