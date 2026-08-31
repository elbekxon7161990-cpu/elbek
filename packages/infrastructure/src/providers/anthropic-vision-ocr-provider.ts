import Anthropic from '@anthropic-ai/sdk';
import {
  OcrProviderAuthenticationError,
  OcrProviderInvalidImageError,
  OcrProviderMalformedResponseError,
  OcrProviderRateLimitError,
  OcrProviderTimeoutError,
  OcrProviderUnavailableError,
} from '@afa/domain';
import type {
  DetectedLanguage,
  OcrContentClassification,
  OcrExtractionRequest,
  OcrExtractionResult,
  OcrProvider,
} from '@afa/domain';

const PROVIDER_NAME = 'anthropic-vision';
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const STRUCTURED_OCR_TOOL_NAME = 'report_ocr_result';

/** Claude's vision API accepts exactly these four media types — anything else must be rejected before ever reaching the API, per this port's own `evaluateImageValidity` pre-flight contract at the call site. */
const SUPPORTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const STRUCTURED_OCR_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rawText', 'contentClassification', 'detectedLanguage', 'confidence'],
  properties: {
    rawText: {
      type: 'string',
      description:
        'Every piece of text visible in the image, transcribed as literally as possible, preserving line breaks. Empty string if no text is visible at all.',
    },
    contentClassification: {
      type: 'string',
      enum: ['receipt', 'screenshot', 'invoice', 'unknown'],
      description: 'Best-effort classification of what kind of document this image shows.',
    },
    detectedLanguage: {
      type: ['string', 'null'],
      enum: ['uz', 'ru', 'en', null],
      description: 'The dominant language of the visible text, or null if it cannot be determined.',
    },
    confidence: {
      type: 'number',
      description:
        'Your own honest confidence (0.0-1.0) that rawText is an accurate, complete transcription of the image. Use a LOW value for blurry, cut-off, handwritten, or otherwise hard-to-read images — never inflate this to seem helpful.',
    },
  },
} as const;

interface StructuredOcrToolOutput {
  rawText: string;
  contentClassification: OcrContentClassification;
  detectedLanguage: DetectedLanguage | null;
  confidence: number;
}

function instructionFor(contentHint: OcrContentClassification | undefined): string {
  const hint =
    contentHint === 'screenshot'
      ? 'This is likely a screenshot of a bank/payment app notification, not a physical receipt.'
      : 'This is likely a photographed physical receipt or cheque.';
  return (
    `${hint} Read every piece of text visible in the image exactly as it appears — do not translate, ` +
    'summarize, or correct it. The text may be in Uzbek (Latin or Cyrillic script), Russian, or English. ' +
    'Call the report_ocr_result tool exactly once with your transcription.'
  );
}

/**
 * TASK-AI-006 — the real `OcrProvider` implementation, reusing this
 * project's own existing Anthropic relationship (same vendor, same SDK,
 * same billing account already proven by `AnthropicLlmProvider`) rather
 * than introducing a new cloud vendor. Deliberately a SEPARATE class from
 * `AnthropicLlmProvider` — `LlmProvider`'s own port (`LlmMessage.content:
 * string`) has no multimodal content-block support, and extending that
 * already-closed, heavily-used shared contract just for this one adapter
 * would be a real, unnecessary risk (see this task's own pre-implementation
 * audit for the full reasoning). This class constructs its own `Anthropic`
 * SDK request directly; `@afa/application` never sees anything
 * Anthropic-specific, exactly like every other provider in this codebase.
 *
 * Uses the SAME forced tool-use structured-output pattern
 * `AnthropicLlmProvider` already established (Chapter 4 §4.16) — never
 * asks the model for "JSON in a text response" and string-parses it.
 *
 * Retry/circuit-breaking is NOT implemented here — `RetryingOcrProvider`/
 * `CircuitBreakerOcrProvider` (already built, previously unwired) compose
 * around this class, mirroring `LlmProviderModule`'s own established
 * composition exactly. The Anthropic SDK client this class is constructed
 * with must be configured with `maxRetries: 0` by its caller so the SDK's
 * own internal retry never doubles up with `RetryingOcrProvider`'s.
 */
export class AnthropicVisionOcrProvider implements OcrProvider {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    /** The `timeout` the client was configured with (ms) — surfaced on `OcrProviderTimeoutError`, since the SDK's own timeout error doesn't carry it back out. */
    private readonly timeoutMs: number,
  ) {}

  async extractText(request: OcrExtractionRequest): Promise<OcrExtractionResult> {
    if (!SUPPORTED_MEDIA_TYPES.has(request.mimeType)) {
      throw new OcrProviderInvalidImageError(
        PROVIDER_NAME,
        `unsupported media type "${request.mimeType}" — Claude vision accepts JPEG/PNG/WebP/GIF only`,
      );
    }

    const startedAt = Date.now();
    let response: Anthropic.Messages.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: request.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                  data: request.image.toString('base64'),
                },
              },
              { type: 'text', text: instructionFor(request.contentHint) },
            ],
          },
        ],
        tools: [
          {
            name: STRUCTURED_OCR_TOOL_NAME,
            description: 'Report the OCR transcription and classification of the image.',
            input_schema: STRUCTURED_OCR_JSON_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: STRUCTURED_OCR_TOOL_NAME },
      });
    } catch (error) {
      throw this.mapError(error);
    }

    const parsed = this.extractToolOutput(response);
    return {
      rawText: parsed.rawText,
      contentClassification: parsed.contentClassification,
      detectedLanguage: parsed.detectedLanguage,
      confidence: parsed.confidence,
      providerModelIdentifier: response.model,
      processingDurationMs: Date.now() - startedAt,
    };
  }

  private extractToolOutput(response: Anthropic.Messages.Message): StructuredOcrToolOutput {
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === 'tool_use' && block.name === STRUCTURED_OCR_TOOL_NAME,
    );
    if (!toolUseBlock) {
      throw new OcrProviderMalformedResponseError(PROVIDER_NAME);
    }
    const input = toolUseBlock.input as Partial<StructuredOcrToolOutput> | null;
    if (
      !input ||
      typeof input.rawText !== 'string' ||
      typeof input.confidence !== 'number' ||
      typeof input.contentClassification !== 'string'
    ) {
      throw new OcrProviderMalformedResponseError(PROVIDER_NAME);
    }
    return {
      rawText: input.rawText,
      contentClassification: input.contentClassification as OcrContentClassification,
      detectedLanguage: (input.detectedLanguage as DetectedLanguage | null | undefined) ?? null,
      confidence: input.confidence,
    };
  }

  /**
   * Never includes the raw SDK error body or any request/credential detail
   * in the mapped error's message — only the six existing `OcrProviderError`
   * subclasses' own fixed, generic messages ever reach a caller.
   */
  private mapError(error: unknown): Error {
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      return new OcrProviderAuthenticationError(PROVIDER_NAME);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return new OcrProviderRateLimitError(PROVIDER_NAME, this.extractRetryAfterMs(error));
    }
    // Must precede the APIConnectionError check below — APIConnectionTimeoutError extends it.
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new OcrProviderTimeoutError(PROVIDER_NAME, this.timeoutMs);
    }
    if (
      error instanceof Anthropic.BadRequestError ||
      error instanceof Anthropic.UnprocessableEntityError ||
      error instanceof Anthropic.NotFoundError
    ) {
      return new OcrProviderInvalidImageError(PROVIDER_NAME, 'the provider rejected this request');
    }
    if (error instanceof Anthropic.APIError) {
      return new OcrProviderUnavailableError(PROVIDER_NAME);
    }
    return new OcrProviderUnavailableError(PROVIDER_NAME);
  }

  private extractRetryAfterMs(
    error: InstanceType<typeof Anthropic.RateLimitError>,
  ): number | undefined {
    try {
      const header = error.headers?.get('retry-after');
      if (!header) {
        return undefined;
      }
      const seconds = Number(header);
      return Number.isFinite(seconds) ? seconds * 1000 : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Exported so `RoutePhotoMessageUseCase`'s own `evaluateImageValidity` (or a future OCR-specific pre-flight check) can stay in sync with what this adapter actually accepts, without duplicating the literal set. */
export { SUPPORTED_MEDIA_TYPES as ANTHROPIC_VISION_SUPPORTED_MEDIA_TYPES };
