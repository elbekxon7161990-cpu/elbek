import { describe, expect, it } from 'vitest';

import { normalizeTranscript } from './normalize-transcript';

describe('normalizeTranscript', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalizeTranscript('  spent 45000 on lunch  ')).toBe('spent 45000 on lunch');
  });

  it('collapses repeated internal whitespace', () => {
    expect(normalizeTranscript('spent   45000    on lunch')).toBe('spent 45000 on lunch');
  });

  it('collapses newlines/tabs into single spaces', () => {
    expect(normalizeTranscript('spent 45000\non\tlunch')).toBe('spent 45000 on lunch');
  });

  it('preserves Uzbek and Russian text unchanged, character-for-character (beyond whitespace/Unicode form)', () => {
    expect(normalizeTranscript('50 ming ovqatga ketdi')).toBe('50 ming ovqatga ketdi');
    expect(normalizeTranscript('потратил 50 штук на обед')).toBe('потратил 50 штук на обед');
  });

  it('never rewrites, translates, or reinterprets the content (BR-INP-004)', () => {
    const input = 'maosh keldi, 7 million';
    expect(normalizeTranscript(input)).toBe(input);
  });

  it("never resolves numeric shorthand — that remains Chapter 4's job", () => {
    expect(normalizeTranscript('50 ming')).toBe('50 ming');
  });

  it('handles an already-clean transcript as a no-op', () => {
    expect(normalizeTranscript('spent 45000 on lunch')).toBe('spent 45000 on lunch');
  });

  it('handles an empty string', () => {
    expect(normalizeTranscript('')).toBe('');
  });

  it('handles a whitespace-only transcript, collapsing to empty', () => {
    expect(normalizeTranscript('   \n\t  ')).toBe('');
  });
});
