import { describe, expect, it } from 'vitest';

import { runIntentClassificationEvaluation } from './intent-classification-evaluation';
import type { IntentClassificationEvaluationCase } from './intent-classification-evaluation';
import type { AiIntent } from './transaction-extraction-schema';

/**
 * These tests verify the harness's own arithmetic against a deterministic
 * fake classifier. They are NOT the real NFR-AI-002 benchmark (no real
 * provider, no human-labeled corpus) — see this module's own doc comment.
 */
describe('runIntentClassificationEvaluation', () => {
  const cases: IntentClassificationEvaluationCase[] = [
    { inputText: 'spent 50k on lunch', expectedIntent: 'EXPENSE' },
    { inputText: '50 ming ovqatga ketdi', expectedIntent: 'EXPENSE' },
    { inputText: 'maosh keldi, 7 million', expectedIntent: 'SALARY' },
    { inputText: 'how much did I spend this month?', expectedIntent: 'QUERY_REPORT' },
  ];

  function fakeClassifier(overrides: Record<string, AiIntent> = {}) {
    return async (inputText: string): Promise<AiIntent> => {
      if (overrides[inputText]) {
        return overrides[inputText] as AiIntent;
      }
      const match = cases.find((c) => c.inputText === inputText);
      return match ? match.expectedIntent : 'UNKNOWN';
    };
  }

  it('reports 100% accuracy when every classification matches', async () => {
    const result = await runIntentClassificationEvaluation(cases, fakeClassifier());

    expect(result.total).toBe(4);
    expect(result.correct).toBe(4);
    expect(result.accuracy).toBe(1);
    expect(result.mismatches).toHaveLength(0);
  });

  it('computes a fractional accuracy and lists mismatches when some classifications are wrong', async () => {
    const result = await runIntentClassificationEvaluation(
      cases,
      fakeClassifier({ 'maosh keldi, 7 million': 'INCOME' }),
    );

    expect(result.correct).toBe(3);
    expect(result.accuracy).toBe(0.75);
    expect(result.mismatches).toEqual([
      { inputText: 'maosh keldi, 7 million', expectedIntent: 'SALARY', actualIntent: 'INCOME' },
    ]);
  });

  it('returns 0 accuracy (not NaN/Infinity) for an empty case set', async () => {
    const result = await runIntentClassificationEvaluation([], fakeClassifier());

    expect(result.total).toBe(0);
    expect(result.accuracy).toBe(0);
  });

  it('never calls a real network/provider — only the injected classify function', async () => {
    let callCount = 0;
    const countingClassifier = async (inputText: string): Promise<AiIntent> => {
      callCount += 1;
      return cases.find((c) => c.inputText === inputText)?.expectedIntent ?? 'UNKNOWN';
    };

    await runIntentClassificationEvaluation(cases, countingClassifier);

    expect(callCount).toBe(cases.length);
  });
});
