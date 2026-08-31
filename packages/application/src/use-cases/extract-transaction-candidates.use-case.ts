import { Inject, Injectable } from '@nestjs/common';
import type {
  CandidateGuardrailReport,
  ExtractionContext,
  StructuredExtractionOutput,
} from '@afa/domain';
import {
  applyHallucinationPreventionLayers,
  applyIntentConfidenceThreshold,
  buildExtractionRequest,
} from '@afa/domain';

import { ValidateStructuredAiOutputUseCase } from './validate-structured-ai-output.use-case';

/**
 * TASK-AI-002 — the values `LlmCompletionRequest.model` (a required field,
 * TASK-INFRA-010) needs that this task has no PRD-mandated default for.
 * Left to the composition root that eventually binds a concrete
 * `LlmProvider`, same split as `LLM_PROVIDER` itself not being bound by
 * `AiExtractionModule`. `intentConfidenceThreshold` defaults to FR-AI-013's
 * documented 0.6 (see `applyIntentConfidenceThreshold`) when omitted.
 */
export interface ExtractionModelConfig {
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  intentConfidenceThreshold?: number;
}

export const EXTRACTION_MODEL_CONFIG = Symbol('EXTRACTION_MODEL_CONFIG');

export interface ExtractionValidResult {
  status: 'valid';
  output: StructuredExtractionOutput;
  /** TASK-AI-003's audit trail — one report per `output.transactions[i]`, same order. */
  candidateReports: readonly CandidateGuardrailReport[];
}

export interface ExtractionUnknownResult {
  status: 'unknown';
  reason: string;
}

export type ExtractionOutcome = ExtractionValidResult | ExtractionUnknownResult;

/**
 * TASK-AI-002 (Chapter 4 §4.3-§4.4; `FR-AI-*` core extraction block;
 * `NFR-AI-002`) + TASK-AI-003 (Chapter 4 §4.8 Hallucination-Prevention
 * Layers) — the full component chain from §4.13.1/§4.13.2, composed as one
 * use case:
 *
 *   ExtractionContext (caller-assembled, §4.7)
 *     -> buildExtractionRequest (Prompt Composer, §4.5/§4.15 Extraction Template — layer 1: prompt)
 *     -> ValidateStructuredAiOutputUseCase (TASK-AI-001 — provider call + schema validation + retry — layer 2: schema)
 *     -> applyIntentConfidenceThreshold (FR-AI-013)
 *     -> applyHallucinationPreventionLayers (TASK-AI-003 — layers 3-6: grounding, confidence-gating, sanity bounds, audit trail)
 *     -> ExtractionOutcome
 *
 * The breakdown's own TASK-AI-003 Description ("prompt, schema, grounding,
 * confidence-gating, sanity-bounds, and audit-trail layers, built together
 * -- not sequentially") is why this task extends TASK-AI-002's use case in
 * place rather than adding a second, separately-callable "guard" use case:
 * a hallucination-prevention layer a caller could forget to invoke would
 * not be the "hard requirement, not best-effort" §4.1 describes. Every
 * caller of this use case gets full protection automatically.
 *
 * Deliberately reuses `ValidateStructuredAiOutputUseCase` and the AI-003
 * domain functions rather than reimplementing any of them — this use
 * case's own job is only composition (context -> request, and wiring the
 * layers together in the right order).
 *
 * Never persists anything, never calls Telegram, never touches Prisma —
 * model routing/tiering (§4.18) remains out of scope (Module boundary is
 * §4.3-§4.4/§4.8 only).
 */
@Injectable()
export class ExtractTransactionCandidatesUseCase {
  constructor(
    private readonly validateStructuredAiOutputUseCase: ValidateStructuredAiOutputUseCase,
    @Inject(EXTRACTION_MODEL_CONFIG) private readonly config: ExtractionModelConfig,
  ) {}

  async execute(context: ExtractionContext): Promise<ExtractionOutcome> {
    const { systemInstructions, userMessage } = buildExtractionRequest(context);

    const outcome = await this.validateStructuredAiOutputUseCase.execute({
      systemInstructions,
      messages: [{ role: 'user', content: userMessage }],
      model: this.config.model,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxOutputTokens,
    });

    if (outcome.status !== 'valid') {
      return outcome;
    }

    const afterIntentGate = applyIntentConfidenceThreshold(
      outcome.output,
      this.config.intentConfidenceThreshold,
    );
    const { output, candidateReports } = applyHallucinationPreventionLayers(
      afterIntentGate,
      context.inputText,
      context.currentDateTime,
    );

    return { status: 'valid', output, candidateReports };
  }
}
