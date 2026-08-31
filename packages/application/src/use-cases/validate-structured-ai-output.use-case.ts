import { Inject, Injectable } from '@nestjs/common';
import type { LlmCompletionRequest, LlmProvider, StructuredExtractionOutput } from '@afa/domain';
import {
  LLM_PROVIDER,
  SchemaValidationError,
  STRUCTURED_EXTRACTION_JSON_SCHEMA,
  validateStructuredExtractionOutput,
} from '@afa/domain';

/**
 * AC-AI-004's exact wording — kept short and generic (not a full prompt
 * template; Step 10 explicitly scopes this task away from the complete
 * prompt-engineering system, which is TASK-AI-002's §4.5 concern).
 */
const SCHEMA_REMINDER =
  'Your previous response did not conform to the required JSON schema. Respond again with a single JSON object that matches the schema exactly — every required field present, no additional fields, correct types and enum values.';

export interface StructuredAiExtractionValidResult {
  status: 'valid';
  output: StructuredExtractionOutput;
}

/**
 * AC-AI-004 — "if the retry also fails, the intent is set to UNKNOWN and
 * no malformed data reaches the Domain Service Layer". This is that
 * escalation: never a thrown error for a schema/parse failure, always a
 * resolved, explicit signal the caller (a later AI/application task) can
 * route to the clarification flow.
 */
export interface StructuredAiExtractionUnknownResult {
  status: 'unknown';
  reason: string;
}

export type StructuredAiExtractionOutcome =
  StructuredAiExtractionValidResult | StructuredAiExtractionUnknownResult;

/**
 * TASK-AI-001 (Chapter 4 §4.9's "LLM returns malformed/schema-invalid
 * output" row; NFR-AI-003; AC-AI-004) — orchestrates exactly what AC-AI-004
 * describes: call the provider, validate the response; on failure, retry
 * once with a schema reminder appended; on a second failure, escalate to
 * `{ status: 'unknown' }` rather than throwing or passing malformed data
 * onward.
 *
 * Deliberately does *not* catch errors thrown by `provider.complete()`
 * itself (`LlmProviderError` and subclasses — auth/timeout/rate-limit/
 * unavailable) — those are TASK-INFRA-010's own resilience concern,
 * already handled by whichever `Retrying`/`CircuitBreaker`/`Fallback`
 * decorator composition wraps the injected `LlmProvider`. This use case's
 * retry is specifically for *schema-invalid content* in an otherwise-
 * successful response, a different failure class from "the provider call
 * itself failed".
 *
 * Never persists anything, never calls Telegram, never touches Prisma —
 * `LLM_PROVIDER` is its only dependency.
 */
@Injectable()
export class ValidateStructuredAiOutputUseCase {
  constructor(@Inject(LLM_PROVIDER) private readonly provider: LlmProvider) {}

  async execute(request: LlmCompletionRequest): Promise<StructuredAiExtractionOutcome> {
    const first = await this.attempt(request);
    if (first.status === 'valid') {
      return first;
    }

    const retryRequest: LlmCompletionRequest = {
      ...request,
      systemInstructions: request.systemInstructions
        ? `${request.systemInstructions}\n\n${SCHEMA_REMINDER}`
        : SCHEMA_REMINDER,
    };
    const second = await this.attempt(retryRequest);
    if (second.status === 'valid') {
      return second;
    }

    return { status: 'unknown', reason: second.reason };
  }

  private async attempt(request: LlmCompletionRequest): Promise<StructuredAiExtractionOutcome> {
    const completion = await this.provider.complete({
      ...request,
      responseSchema: STRUCTURED_EXTRACTION_JSON_SCHEMA,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(completion.content);
    } catch {
      // Never logs `completion.content` itself — it may contain raw user
      // financial data (Chapter 16 §16.3 data minimization / this task's
      // own Step 6).
      return { status: 'unknown', reason: 'Provider response was not valid JSON.' };
    }

    try {
      const output = validateStructuredExtractionOutput(parsed);
      return { status: 'valid', output };
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        return { status: 'unknown', reason: error.message };
      }
      throw error;
    }
  }
}
