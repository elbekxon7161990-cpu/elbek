import { describe, expect, it } from 'vitest';

import { isCancellationPhrase } from './is-cancellation-phrase';

describe('isCancellationPhrase (§5.6/§5.18.3)', () => {
  it('matches "cancel"', () => {
    expect(isCancellationPhrase('cancel')).toBe(true);
  });

  it('matches "nevermind"', () => {
    expect(isCancellationPhrase('nevermind')).toBe(true);
  });

  it('matches Uzbek "bekor qil"', () => {
    expect(isCancellationPhrase('bekor qil')).toBe(true);
  });

  it('matches Russian "отмена"', () => {
    expect(isCancellationPhrase('отмена')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isCancellationPhrase('CANCEL')).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(isCancellationPhrase('  cancel  ')).toBe(true);
  });

  it('does not match an unrelated message', () => {
    expect(isCancellationPhrase('spent 45000 on lunch')).toBe(false);
  });

  it('does not match a message that merely contains a cancellation word as a substring (exact-phrase match only, per the fixed-list design)', () => {
    expect(isCancellationPhrase('please cancel my subscription reminder')).toBe(false);
  });

  it('does not match an empty string', () => {
    expect(isCancellationPhrase('')).toBe(false);
  });
});
