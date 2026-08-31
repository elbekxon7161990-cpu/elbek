import type { AiIntent } from './transaction-extraction-schema';

/**
 * TASK-AI-002's Test Requirement is "Unit + evaluation-set benchmark run"
 * and its Definition of Done is "Intent classification accuracy on the
 * UZ/RU/EN evaluation set meets NFR-AI-002's MVP target (>= 90%)".
 *
 * This module is the reusable *harness* only — a generic, deterministic
 * accuracy calculator. It does NOT itself constitute a real benchmark run:
 * per BR-AI-007 ("evaluation benchmark ground truth must be human-labeled")
 * a genuine NFR-AI-002 measurement needs (a) a real, human-labeled UZ/RU/EN
 * evaluation corpus and (b) a real bound LLM provider — neither of which
 * exists in this repository or environment. Running this harness against a
 * deterministic test double (as this package's own tests do) proves the
 * harness's accuracy arithmetic is correct; it is not a substitute for, and
 * must never be reported as, the real NFR-AI-002 benchmark.
 */
export interface IntentClassificationEvaluationCase {
  inputText: string;
  expectedIntent: AiIntent;
}

export interface IntentClassificationMismatch {
  inputText: string;
  expectedIntent: AiIntent;
  actualIntent: AiIntent;
}

export interface IntentClassificationEvaluationResult {
  total: number;
  correct: number;
  accuracy: number;
  mismatches: readonly IntentClassificationMismatch[];
}

export async function runIntentClassificationEvaluation(
  cases: readonly IntentClassificationEvaluationCase[],
  classify: (inputText: string) => Promise<AiIntent>,
): Promise<IntentClassificationEvaluationResult> {
  const mismatches: IntentClassificationMismatch[] = [];
  let correct = 0;

  for (const testCase of cases) {
    const actualIntent = await classify(testCase.inputText);
    if (actualIntent === testCase.expectedIntent) {
      correct += 1;
    } else {
      mismatches.push({
        inputText: testCase.inputText,
        expectedIntent: testCase.expectedIntent,
        actualIntent,
      });
    }
  }

  return {
    total: cases.length,
    correct,
    accuracy: cases.length === 0 ? 0 : correct / cases.length,
    mismatches,
  };
}
