import { describe, expect, it } from 'vitest';

import { classifyInterruption } from './classify-interruption';
import type { ClassifyInterruptionInput } from './classify-interruption';

const BASE: ClassifyInterruptionInput = {
  text: 'anything',
  pendingIntent: 'EXPENSE',
  reinterpretedIntent: null,
  reinterpretedClassification: null,
};

describe('classifyInterruption (TASK-BOT-005, §5.6/§5.12.1/BR-CE-011)', () => {
  it('classifies a recognized cancellation phrase as cancellation, regardless of any reinterpretation signal', () => {
    expect(
      classifyInterruption({
        ...BASE,
        text: 'cancel',
        reinterpretedIntent: 'SALARY',
        reinterpretedClassification: 'auto_commit',
      }),
    ).toBe('cancellation');
  });

  it('cancellation phrase matching is case/whitespace-insensitive, reusing isCancellationPhrase exactly', () => {
    expect(classifyInterruption({ ...BASE, text: '  Bekor Qil  ' })).toBe('cancellation');
  });

  it('classifies a different-intent, auto_commit (high-confidence) reinterpretation as unrelated-new-transaction (§5.6/AC-CE-004)', () => {
    expect(
      classifyInterruption({
        ...BASE,
        text: 'maosh keldi, 7 million',
        pendingIntent: 'EXPENSE',
        reinterpretedIntent: 'SALARY',
        reinterpretedClassification: 'auto_commit',
      }),
    ).toBe('unrelated-new-transaction');
  });

  it('classifies a SAME-intent, auto_commit reinterpretation as continuation — not "unrelated" merely because it is high-confidence', () => {
    expect(
      classifyInterruption({
        ...BASE,
        pendingIntent: 'EXPENSE',
        reinterpretedIntent: 'EXPENSE',
        reinterpretedClassification: 'auto_commit',
      }),
    ).toBe('continuation');
  });

  it('classifies a different-intent but flagged_review (medium-confidence) reinterpretation as continuation — only auto_commit-band counts as "high-confidence" per §5.6', () => {
    expect(
      classifyInterruption({
        ...BASE,
        pendingIntent: 'EXPENSE',
        reinterpretedIntent: 'SALARY',
        reinterpretedClassification: 'flagged_review',
      }),
    ).toBe('continuation');
  });

  it('classifies a different-intent but draft_pending_clarification reinterpretation as continuation', () => {
    expect(
      classifyInterruption({
        ...BASE,
        pendingIntent: 'EXPENSE',
        reinterpretedIntent: 'DEBT_GIVEN',
        reinterpretedClassification: 'draft_pending_clarification',
      }),
    ).toBe('continuation');
  });

  it('classifies as continuation (fail-closed) when the pending draft could not be found — never guesses "unrelated" without a real baseline', () => {
    expect(
      classifyInterruption({
        ...BASE,
        pendingIntent: null,
        reinterpretedIntent: 'SALARY',
        reinterpretedClassification: 'auto_commit',
      }),
    ).toBe('continuation');
  });

  it('classifies extraction failure/empty result (null reinterpretation) as continuation — never left unclassified (BR-CE-011)', () => {
    expect(
      classifyInterruption({
        ...BASE,
        reinterpretedIntent: null,
        reinterpretedClassification: null,
      }),
    ).toBe('continuation');
  });

  it('every call returns exactly one of the three declared categories, never undefined/null (BR-CE-011)', () => {
    const outcome = classifyInterruption(BASE);
    expect(['continuation', 'unrelated-new-transaction', 'cancellation']).toContain(outcome);
  });
});
