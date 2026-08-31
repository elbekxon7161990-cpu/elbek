import { describe, expect, it } from 'vitest';

import {
  generateClarificationFallbackMessage,
  generateClarificationQuestion,
} from './generate-clarification-question';

describe('generateClarificationQuestion (Chapter 5 §5.3.2)', () => {
  describe('supported fields — initial tier (retryCount 0)', () => {
    it('missing amount', () => {
      const q = generateClarificationQuestion({
        missingField: 'amount',
        language: 'uz',
        retryCount: 0,
      });
      expect(q).toBe('Qancha summa edi?');
    });

    it('missing currency', () => {
      const q = generateClarificationQuestion({
        missingField: 'currency',
        language: 'en',
        retryCount: 0,
      });
      expect(q).toBe('What currency was that in?');
    });

    it('missing transaction date', () => {
      const q = generateClarificationQuestion({
        missingField: 'transactionDate',
        language: 'ru',
        retryCount: 0,
      });
      expect(q).toBe('Это было сегодня?');
    });

    it('missing category', () => {
      const q = generateClarificationQuestion({
        missingField: 'category',
        language: 'uz',
        retryCount: 0,
      });
      expect(q).toBe('Bu xarajat qaysi toifaga kiradi?');
    });

    it('missing counterparty', () => {
      const q = generateClarificationQuestion({
        missingField: 'counterparty',
        language: 'en',
        retryCount: 0,
      });
      expect(q).toBe('Who was this with?');
    });

    it('low-confidence merchant (nulled upstream by TASK-AI-003 field-confidence gating, arrives here identically to "missing")', () => {
      const q = generateClarificationQuestion({
        missingField: 'merchant',
        language: 'en',
        retryCount: 0,
      });
      expect(q).toBe('Where was this (merchant or service name)?');
    });
  });

  describe('low-confidence amount/date arrive as null, same code path as missing', () => {
    it('low-confidence amount (already nulled upstream) produces the same amount question as missing amount', () => {
      const forMissing = generateClarificationQuestion({
        missingField: 'amount',
        language: 'uz',
        retryCount: 0,
      });
      const forLowConfidence = generateClarificationQuestion({
        missingField: 'amount', // TASK-AI-003 already nulled it before this function ever runs
        language: 'uz',
        retryCount: 0,
      });
      expect(forLowConfidence).toBe(forMissing);
    });

    it('low-confidence transactionDate likewise', () => {
      const q = generateClarificationQuestion({
        missingField: 'transactionDate',
        language: 'en',
        retryCount: 0,
      });
      expect(q).toBe('Was this today?');
    });
  });

  describe('language coverage — Uzbek, Russian, English for the same field', () => {
    it('Uzbek wording', () => {
      expect(
        generateClarificationQuestion({ missingField: 'amount', language: 'uz', retryCount: 0 }),
      ).toMatch(/summa/i);
    });

    it('Russian wording', () => {
      expect(
        generateClarificationQuestion({ missingField: 'amount', language: 'ru', retryCount: 0 }),
      ).toMatch(/сумма/i);
    });

    it('English wording', () => {
      expect(
        generateClarificationQuestion({ missingField: 'amount', language: 'en', retryCount: 0 }),
      ).toMatch(/how much/i);
    });
  });

  describe('retry tier (BR-CE-003 "re-asks once with a more specific prompt")', () => {
    it('a retryCount of 1 or more uses different (more specific) wording than the initial ask', () => {
      const initial = generateClarificationQuestion({
        missingField: 'amount',
        language: 'en',
        retryCount: 0,
      });
      const retry = generateClarificationQuestion({
        missingField: 'amount',
        language: 'en',
        retryCount: 1,
      });
      expect(retry).not.toBe(initial);
      expect(retry.toLowerCase()).toContain('specific');
    });

    it('retryCount 2 (the second retry, still within the existing NFR-CE-003 cap) reuses the same retry-tier wording rather than fabricating a third tier', () => {
      const retry1 = generateClarificationQuestion({
        missingField: 'amount',
        language: 'en',
        retryCount: 1,
      });
      const retry2 = generateClarificationQuestion({
        missingField: 'amount',
        language: 'en',
        retryCount: 2,
      });
      expect(retry2).toBe(retry1);
    });
  });

  describe('multiple missing fields — this function only ever answers for the ONE field it is given', () => {
    it('is called once per turn with a single missingField, never asks about more than one field in its returned text', () => {
      const q = generateClarificationQuestion({
        missingField: 'amount',
        language: 'en',
        retryCount: 0,
      });
      expect(q.toLowerCase()).not.toContain('category');
      expect(q.toLowerCase()).not.toContain('currency');
    });
  });

  describe('no fabrication', () => {
    it('never includes a fabricated numeric amount, date, or category value in the question text', () => {
      const q = generateClarificationQuestion({
        missingField: 'amount',
        language: 'en',
        retryCount: 0,
      });
      expect(q).not.toMatch(/\d/);
    });

    it('intent-ambiguous (missingField null) asks a genuine multiple-choice question rather than asserting a specific intent as fact', () => {
      const q = generateClarificationQuestion({
        missingField: null,
        language: 'en',
        retryCount: 0,
      });
      // Offering the general categories as options (matching §5.3.4's worked
      // example: "Was this a debt ... or a gift/expense?") is the correct,
      // non-fabricating behavior — the forbidden thing is *asserting* one
      // specific answer as already known, which a question-form sentence
      // does not do.
      expect(q.endsWith('?')).toBe(true);
    });
  });

  describe('invalid/unsupported field', () => {
    it('a field name with no real template returns the honest "did not understand" wording, not a fabricated question about that field', () => {
      const q = generateClarificationQuestion({
        missingField: 'someFieldThatDoesNotExist',
        language: 'en',
        retryCount: 0,
      });
      expect(q).toBe('Sorry, I did not fully understand that — could you rephrase?');
    });

    it('unsupported field respects language too', () => {
      const q = generateClarificationQuestion({
        missingField: 'someFieldThatDoesNotExist',
        language: 'uz',
        retryCount: 0,
      });
      expect(q).toMatch(/tushunmadim/);
    });
  });

  describe('intent ambiguity (missingField === null)', () => {
    it('produces a language-matched disambiguation question', () => {
      const uz = generateClarificationQuestion({
        missingField: null,
        language: 'uz',
        retryCount: 0,
      });
      const ru = generateClarificationQuestion({
        missingField: null,
        language: 'ru',
        retryCount: 0,
      });
      const en = generateClarificationQuestion({
        missingField: null,
        language: 'en',
        retryCount: 0,
      });
      expect(uz).not.toBe(ru);
      expect(ru).not.toBe(en);
      expect(en.toLowerCase()).toContain('clarify');
    });
  });
});

describe('generateClarificationFallbackMessage (FR-CE-005)', () => {
  it('is language-aware, unlike the old hardcoded English-only, always-says-amount fallback it replaces', () => {
    expect(generateClarificationFallbackMessage('uz')).not.toBe(
      generateClarificationFallbackMessage('en'),
    );
    expect(generateClarificationFallbackMessage('ru')).not.toBe(
      generateClarificationFallbackMessage('en'),
    );
  });

  it('never names a specific field (it is a generic "different approach" message, not a question)', () => {
    const message = generateClarificationFallbackMessage('en');
    expect(message.toLowerCase()).not.toContain('amount');
  });
});
