import { describe, expect, it } from 'vitest';

import { resolveReplyLanguage, toDetectedLanguage } from './resolve-reply-language';

describe('resolveReplyLanguage (TASK-BOT-008, Chapter 4 §4.2.2)', () => {
  it('uses the preferred language when set, regardless of the detected language', () => {
    expect(resolveReplyLanguage('uz', 'ru')).toBe('uz');
    expect(resolveReplyLanguage('ru', 'en')).toBe('ru');
    expect(resolveReplyLanguage('en', 'uz')).toBe('en');
  });

  it('falls back to the detected language when no preferred language is set', () => {
    expect(resolveReplyLanguage(null, 'uz')).toBe('uz');
    expect(resolveReplyLanguage(null, 'ru')).toBe('ru');
    expect(resolveReplyLanguage(null, 'en')).toBe('en');
    expect(resolveReplyLanguage(undefined, 'uz')).toBe('uz');
  });

  it('falls back to "en" when neither a preferred nor a detected language is available', () => {
    expect(resolveReplyLanguage(null, null)).toBe('en');
    expect(resolveReplyLanguage(undefined, undefined)).toBe('en');
    expect(resolveReplyLanguage(null, undefined)).toBe('en');
    expect(resolveReplyLanguage(undefined, null)).toBe('en');
  });

  it('never derives understanding from this function — it only ever returns a reply language', () => {
    // Documents the §4.2.2 boundary this function exists to enforce: it has
    // no "understanding" input/output at all, structurally preventing a
    // caller from misusing it for anything but reply-language selection.
    const result: 'uz' | 'ru' | 'en' = resolveReplyLanguage('ru', 'en');
    expect(result).toBe('ru');
  });
});

describe('toDetectedLanguage (TASK-BOT-008) — safely narrows the raw users.preferred_language string', () => {
  it('accepts each of the three supported languages', () => {
    expect(toDetectedLanguage('uz')).toBe('uz');
    expect(toDetectedLanguage('ru')).toBe('ru');
    expect(toDetectedLanguage('en')).toBe('en');
  });

  it('returns null for a value outside the three supported languages, never passing it through', () => {
    expect(toDetectedLanguage('fr')).toBeNull();
    expect(toDetectedLanguage('UZ')).toBeNull(); // case-sensitive, matching the DB CHECK constraint exactly
    expect(toDetectedLanguage('')).toBeNull();
  });

  it('returns null for null/undefined without throwing', () => {
    expect(toDetectedLanguage(null)).toBeNull();
    expect(toDetectedLanguage(undefined)).toBeNull();
  });
});
