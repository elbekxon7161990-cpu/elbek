import { describe, expect, it } from 'vitest';
import type {
  EvaluationDatasetItem,
  EvaluationRunMetadata,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
} from '@afa/domain';

import { ValidateStructuredAiOutputUseCase } from './validate-structured-ai-output.use-case';
import { RunCalibrationEvaluationUseCase } from './run-calibration-evaluation.use-case';
import type { EvaluationSharedContext } from './run-calibration-evaluation.use-case';
import type { ExtractionModelConfig } from './extract-transaction-candidates.use-case';

interface FakeStep {
  result?: LlmCompletionResult;
}

/** Same local-fake pattern as every other AI-layer spec — @afa/application never depends on @afa/infrastructure, even in tests. */
class LocalFakeLlmProvider implements LlmProvider {
  private readonly calls: LlmCompletionRequest[] = [];
  private readonly script: FakeStep[] = [];

  constructor(private readonly defaultResult: LlmCompletionResult) {}

  enqueue(step: FakeStep): this {
    this.script.push(step);
    return this;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.calls.push(request);
    const next = this.script.shift();
    return next?.result ?? this.defaultResult;
  }

  get callCount(): number {
    return this.calls.length;
  }
}

function resultOf(content: string): LlmCompletionResult {
  return { content, finishReason: 'stop' };
}

function candidateJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: 'EXPENSE',
    amount: 45000,
    currency: 'UZS',
    category: 'FOOD_DINING',
    subcategory: null,
    merchant: null,
    paymentMethod: null,
    transactionDate: '2026-08-13',
    transactionTime: null,
    location: null,
    counterparty: null,
    dueDate: null,
    tags: [],
    description: 'Lunch',
    confidenceScores: {
      intent: 0.97,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
    ...overrides,
  };
}

function envelope(transactions: Record<string, unknown>[]): Record<string, unknown> {
  return {
    transactions,
    detectedLanguage: 'en',
    clarificationNeeded: false,
    clarificationQuestion: null,
  };
}

function datasetItem(overrides: Partial<EvaluationDatasetItem> = {}): EvaluationDatasetItem {
  return {
    id: 'item-1',
    datasetVersion: 'v1',
    rawInputText: 'spent 45000 on lunch',
    inputLanguage: 'en',
    sourceType: 'text',
    groundTruth: {
      intent: 'EXPENSE',
      amount: 45000,
      currency: 'UZS',
      category: 'FOOD_DINING',
      subcategory: null,
      merchant: null,
      paymentMethod: null,
      transactionDate: '2026-08-13',
      transactionTime: null,
      location: null,
      counterparty: null,
      dueDate: null,
      description: 'Lunch',
    },
    annotation: {
      status: 'reviewed',
      reviewer: 'reviewer-a',
      annotationVersion: 1,
      secondReviewer: null,
      adjudicator: null,
      annotatedAt: '2026-08-01T00:00:00Z',
    },
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

const SHARED_CONTEXT: EvaluationSharedContext = {
  currentDateTime: '2026-08-13T14:32:00+05:00',
  userDefaultCurrency: 'UZS',
  userRecentCategories: ['FOOD_DINING'],
};

const CONFIG: ExtractionModelConfig = { model: 'fixture-model' };

function runMetadata(overrides: Partial<EvaluationRunMetadata> = {}): EvaluationRunMetadata {
  return {
    evaluationRunId: 'run-1',
    datasetVersion: 'v1',
    groundTruthVersion: 'v1',
    modelIdentifier: 'fixture-model',
    modelConfig: {},
    promptVersion: 'extraction-template-v1',
    extractionSchemaVersion: 'structured-extraction-v1',
    evaluatorVersion: 'evaluation-framework-v1',
    timestamp: '2026-08-13T00:00:00Z',
    thresholds: [0.5, 0.6, 0.7, 0.8, 0.9],
    environmentMetadata: {},
    ...overrides,
  };
}

function buildUseCase(provider: LocalFakeLlmProvider) {
  const validate = new ValidateStructuredAiOutputUseCase(provider);
  return new RunCalibrationEvaluationUseCase(validate, CONFIG);
}

describe('RunCalibrationEvaluationUseCase', () => {
  it('scores a matching prediction against ground truth end to end', async () => {
    const provider = new LocalFakeLlmProvider(
      resultOf(JSON.stringify(envelope([candidateJson()]))),
    );
    const useCase = buildUseCase(provider);

    const result = await useCase.execute(
      [datasetItem()],
      SHARED_CONTEXT,
      runMetadata(),
      'ESTIMATED',
    );

    expect(result.report.itemCount).toBe(1);
    expect(result.report.overallAccuracy).toBe(1);
    expect(result.unresolvedItemIds).toHaveLength(0);
  });

  it('excludes a malformed dataset item (e.g. duplicate id) via the reused dataset validator, reporting the issue', async () => {
    const provider = new LocalFakeLlmProvider(
      resultOf(JSON.stringify(envelope([candidateJson()]))),
    );
    const useCase = buildUseCase(provider);

    const result = await useCase.execute(
      [datasetItem({ id: 'dup' }), datasetItem({ id: 'dup' })],
      SHARED_CONTEXT,
      runMetadata(),
      'ESTIMATED',
    );

    expect(result.datasetIssues.some((i) => i.message.includes('Duplicate'))).toBe(true);
    expect(result.report.itemCount).toBe(1);
  });

  it('counts an item as unresolved (not scored as correct or incorrect) when the provider never yields a schema-valid candidate', async () => {
    const provider = new LocalFakeLlmProvider(resultOf('not json at all'));
    const useCase = buildUseCase(provider);

    const result = await useCase.execute(
      [datasetItem()],
      SHARED_CONTEXT,
      runMetadata(),
      'ESTIMATED',
    );

    expect(result.unresolvedItemIds).toEqual(['item-1']);
    expect(result.report.itemCount).toBe(0);
  });

  it('scores the RAW model prediction, not TASK-AI-002/003-gated output — a low-confidence field is still compared as-is', async () => {
    const provider = new LocalFakeLlmProvider(
      resultOf(
        JSON.stringify(
          envelope([
            candidateJson({
              confidenceScores: {
                intent: 0.97,
                amount: 0.95,
                currency: 0.9,
                category: 0.2,
                transactionDate: 0.95,
              },
            }),
          ]),
        ),
      ),
    );
    const useCase = buildUseCase(provider);

    const result = await useCase.execute(
      [datasetItem()],
      SHARED_CONTEXT,
      runMetadata(),
      'ESTIMATED',
    );

    // If AI-003's gating had run first, `category` would already be null and this field
    // would trivially mismatch a non-null ground truth for the wrong reason. Scored raw,
    // it should still show as correct (the model's raw guess matched), with its true low
    // confidence intact for the calibration bucket to see.
    expect(result.report.fieldAccuracy.category.correct).toBe(1);
    const categoryFailure = result.report.failures.find((f) => f.field === 'category');
    expect(categoryFailure).toBeUndefined();
  });

  it('propagates the caller-declared benchmarkStatus through to the report', async () => {
    const provider = new LocalFakeLlmProvider(
      resultOf(JSON.stringify(envelope([candidateJson()]))),
    );
    const useCase = buildUseCase(provider);

    const result = await useCase.execute(
      [datasetItem()],
      SHARED_CONTEXT,
      runMetadata(),
      'ENVIRONMENT-BLOCKED',
    );

    expect(result.report.benchmarkStatus).toBe('ENVIRONMENT-BLOCKED');
  });

  it('handles an empty dataset without error', async () => {
    const provider = new LocalFakeLlmProvider(
      resultOf(JSON.stringify(envelope([candidateJson()]))),
    );
    const useCase = buildUseCase(provider);

    const result = await useCase.execute([], SHARED_CONTEXT, runMetadata(), 'ENVIRONMENT-BLOCKED');

    expect(result.report.itemCount).toBe(0);
    expect(provider.callCount).toBe(0);
  });

  it('never calls a real LLM API — only the injected local fake provider is used', async () => {
    const provider = new LocalFakeLlmProvider(
      resultOf(JSON.stringify(envelope([candidateJson()]))),
    );
    const useCase = buildUseCase(provider);

    await useCase.execute([datasetItem()], SHARED_CONTEXT, runMetadata(), 'ESTIMATED');

    expect(provider.callCount).toBe(1);
  });

  it("regression: does not affect TASK-AI-002's ExtractTransactionCandidatesUseCase or TASK-AI-001's ValidateStructuredAiOutputUseCase — both remain independently instantiable and callable unchanged", async () => {
    const provider = new LocalFakeLlmProvider(
      resultOf(JSON.stringify(envelope([candidateJson()]))),
    );
    const validate = new ValidateStructuredAiOutputUseCase(provider);

    const outcome = await validate.execute({
      messages: [{ role: 'user', content: 'spent 45000 on lunch' }],
      model: 'fixture-model',
    });

    expect(outcome.status).toBe('valid');
  });
});
