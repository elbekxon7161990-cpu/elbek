import { describe, expect, it } from 'vitest';

import { normalizeOcrText } from './normalize-ocr-text';

describe('normalizeOcrText', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalizeOcrText('  Korzinka\nTotal: 45000  ')).toBe('Korzinka\nTotal: 45000');
  });

  it('collapses repeated horizontal whitespace within a line', () => {
    expect(normalizeOcrText('Total:    45000')).toBe('Total: 45000');
  });

  it('collapses multiple blank lines into one', () => {
    expect(normalizeOcrText('Korzinka\n\n\n\nTotal: 45000')).toBe('Korzinka\nTotal: 45000');
  });

  it('corrects an "O" misread as part of an otherwise-numeric token', () => {
    expect(normalizeOcrText('Total: 45O00')).toBe('Total: 45000');
  });

  it('corrects a lowercase "l" misread as part of an otherwise-numeric token', () => {
    expect(normalizeOcrText('Total: l00000')).toBe('Total: 100000');
  });

  it('corrects a capital "I" misread as part of an otherwise-numeric token', () => {
    expect(normalizeOcrText('Total: I0000')).toBe('Total: 10000');
  });

  it('never touches a real word, even one containing letters that look like digits (BR-INP-004)', () => {
    expect(normalizeOcrText('Lunch at Korzinka')).toBe('Lunch at Korzinka');
  });

  it('never touches a standalone letter with no digit context', () => {
    expect(normalizeOcrText('O for Oscar')).toBe('O for Oscar');
  });

  it('preserves Uzbek and Russian text unchanged, character-for-character (beyond whitespace/digit-misread cleanup)', () => {
    expect(normalizeOcrText("Oziq-ovqat do'koni")).toBe("Oziq-ovqat do'koni");
    expect(normalizeOcrText('Итого: 45000 сум')).toBe('Итого: 45000 сум');
  });

  it("never resolves numeric shorthand or performs semantic rewriting — that remains Chapter 4's job", () => {
    expect(normalizeOcrText('50 ming')).toBe('50 ming');
  });

  it('handles an empty string', () => {
    expect(normalizeOcrText('')).toBe('');
  });

  it('handles a whitespace-only OCR result, collapsing to empty', () => {
    expect(normalizeOcrText('   \n\n\n  ')).toBe('');
  });
});
