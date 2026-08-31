import { describe, expect, it } from 'vitest';

import { detectCurrencyCandidates, detectMerchantCandidate } from './extract-candidate-signals';

describe('detectCurrencyCandidates (FR-INP-040)', () => {
  it('detects UZS from the "so\'m" symbol', () => {
    expect(detectCurrencyCandidates("Total: 45000 so'm")).toEqual(['UZS']);
  });

  it('detects UZS from the "UZS" code', () => {
    expect(detectCurrencyCandidates('Total: 45000 UZS')).toEqual(['UZS']);
  });

  it('detects USD from the "$" symbol', () => {
    expect(detectCurrencyCandidates('Total: $45.00')).toEqual(['USD']);
  });

  it('detects RUB from the "₽" symbol', () => {
    expect(detectCurrencyCandidates('Итого: 450 ₽')).toEqual(['RUB']);
  });

  it('detects EUR from the "€" symbol', () => {
    expect(detectCurrencyCandidates('Total: €45.00')).toEqual(['EUR']);
  });

  it('returns an empty array when no currency signal is present — never defaults to a guess (FR-INP-041)', () => {
    expect(detectCurrencyCandidates('Total: 45000')).toEqual([]);
  });

  it('detects multiple currency candidates when more than one appears (e.g. a currency-exchange receipt)', () => {
    const candidates = detectCurrencyCandidates('Exchanged $100 for 1,270,000 UZS');
    expect([...candidates].sort()).toEqual(['USD', 'UZS']);
  });

  it('does not duplicate a candidate detected by multiple patterns', () => {
    expect(detectCurrencyCandidates("45000 so'm UZS")).toEqual(['UZS']);
  });

  it("never itself decides the final currency — only surfaces candidates (FR-INP-040's scope boundary)", () => {
    // A pure signal-detection function has no "decide" method at all — this
    // test documents the boundary rather than asserting new behavior.
    expect(Array.isArray(detectCurrencyCandidates('any text'))).toBe(true);
  });
});

describe('detectMerchantCandidate (FR-INP-043)', () => {
  it('returns the first non-empty line as the merchant candidate', () => {
    expect(detectMerchantCandidate('Korzinka\nChilonzor branch\nTotal: 45000')).toBe('Korzinka');
  });

  it('skips leading blank lines', () => {
    expect(detectMerchantCandidate('\n\nKorzinka\nTotal: 45000')).toBe('Korzinka');
  });

  it('trims surrounding whitespace on the candidate line', () => {
    expect(detectMerchantCandidate('   Korzinka   \nTotal: 45000')).toBe('Korzinka');
  });

  it('returns null for text with no non-empty line', () => {
    expect(detectMerchantCandidate('   \n  \n')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(detectMerchantCandidate('')).toBeNull();
  });

  it('handles a single-line OCR result', () => {
    expect(detectMerchantCandidate('Korzinka')).toBe('Korzinka');
  });
});
