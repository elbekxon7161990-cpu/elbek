import { Inject, Injectable } from '@nestjs/common';
import type {
  BenchmarkStatus,
  CalibrationEvaluationReport,
  EvaluationDatasetItem,
  EvaluationRunMetadata,
  EvaluationScoredItem,
} from '@afa/domain';
import {
  buildCalibrationEvaluationReport,
  buildExtractionRequest,
  validateEvaluationDataset,
} from '@afa/domain';

import { EXTRACTION_MODEL_CONFIG } from './extract-transaction-candidates.use-case';
import type { ExtractionModelConfig } from './extract-transaction-candidates.use-case';
import { ValidateStructuredAiOutputUseCase } from './validate-structured-ai-output.use-case';

/**
 * TASK-AI-004 — the I/O-shaped runner that makes the pure domain
 * evaluation framework (`packages/domain/src/ai-extraction/evaluation/`)
 * actually executable against real dataset items. Reuses
 * `ValidateStructuredAiOutputUseCase` (TASK-AI-001) and
 * `buildExtractionRequest` (TASK-AI-002) — the exact same prompt/schema
 * machinery production traffic uses — rather than a second, parallel
 * evaluation-only prediction path.
 *
 * Deliberately calls `ValidateStructuredAiOutputUseCase` directly, NOT
 * `ExtractTransactionCandidatesUseCase` (which also runs TASK-AI-002's
 * intent-confidence gate and TASK-AI-003's hallucination-prevention
 * layers): calibration must score the model's own RAW, self-reported
 * confidence against ground truth. Scoring already-gated output would be
 * circular — every field the deployed 0.6/0.85 thresholds already nulled
 * would trivially show as "confidence too low to be wrong," destroying the
 * exact signal this framework needs to tell whether 0.6/0.85 are the right
 * thresholds in the first place.
 *
 * Ground-truth items whose schema-invalid/malformed provider response
 * never resolves to a scoreable candidate are counted in
 * `unresolvedItemIds`, not silently dropped or scored as correct/incorrect.
 */
export interface EvaluationSharedContext {
  currentDateTime: string;
  userDefaultCurrency: string;
  userRecentCategories: readonly string[];
}

export interface RunCalibrationEvaluationResult {
  report: CalibrationEvaluationReport;
  datasetIssues: readonly { itemId: string; message: string }[];
  unresolvedItemIds: readonly string[];
}

@Injectable()
export class RunCalibrationEvaluationUseCase {
  constructor(
    private readonly validateStructuredAiOutputUseCase: ValidateStructuredAiOutputUseCase,
    @Inject(EXTRACTION_MODEL_CONFIG) private readonly config: ExtractionModelConfig,
  ) {}

  async execute(
    dataset: readonly EvaluationDatasetItem[],
    sharedContext: EvaluationSharedContext,
    runMetadata: EvaluationRunMetadata,
    benchmarkStatus: BenchmarkStatus,
  ): Promise<RunCalibrationEvaluationResult> {
    const { validItems, issues } = validateEvaluationDataset(dataset);

    const scoredItems: EvaluationScoredItem[] = [];
    const unresolvedItemIds: string[] = [];

    for (const item of validItems) {
      const { systemInstructions, userMessage } = buildExtractionRequest({
        currentDateTime: sharedContext.currentDateTime,
        userDefaultCurrency: sharedContext.userDefaultCurrency,
        userRecentCategories: sharedContext.userRecentCategories,
        pendingClarificationContext: null,
        inputText: item.rawInputText,
      });

      const outcome = await this.validateStructuredAiOutputUseCase.execute({
        systemInstructions,
        messages: [{ role: 'user', content: userMessage }],
        model: this.config.model,
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxOutputTokens,
      });

      const prediction = outcome.status === 'valid' ? outcome.output.transactions[0] : undefined;
      if (!prediction) {
        unresolvedItemIds.push(item.id);
        continue;
      }

      scoredItems.push({ datasetItemId: item.id, prediction, groundTruth: item.groundTruth });
    }

    const report = buildCalibrationEvaluationReport(scoredItems, runMetadata, benchmarkStatus);

    return { report, datasetIssues: issues, unresolvedItemIds };
  }
}
