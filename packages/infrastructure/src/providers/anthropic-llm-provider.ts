import Anthropic from '@anthropic-ai/sdk';
import {
  LlmProviderAuthenticationError,
  LlmProviderInvalidRequestError,
  LlmProviderMalformedResponseError,
  LlmProviderRateLimitError,
  LlmProviderTimeoutError,
  LlmProviderUnavailableError,
} from '@afa/domain';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmFinishReason,
  LlmMessage,
  LlmProvider,
} from '@afa/domain';

const PROVIDER_NAME = 'anthropic';
/** Anthropic's own `max_tokens` is a required field with no server-side default; used only when `LlmCompletionRequest.maxOutputTokens` is omitted. */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
/**
 * The tool name this adapter registers when `LlmCompletionRequest.responseSchema`
 * is present. Arbitrary but stable — never surfaced to callers, only used
 * internally to identify the forced tool-use block in Claude's response.
 */
const STRUCTURED_OUTPUT_TOOL_NAME = 'extract_structured_output';

function toAnthropicMessages(messages: readonly LlmMessage[]): Anthropic.Messages.MessageParam[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

/**
 * Chapter 4 §4.16's stop_reason vocabulary mapped onto the port's smaller,
 * provider-neutral `LlmFinishReason`. `'tool_use'`/`'pause_turn'` are both
 * successful-completion outcomes for this adapter's own request shape (a
 * single forced tool call, never a multi-step agentic loop per ADR-AI-001),
 * so both map to `'stop'`, not treated as an error condition.
 */
function mapStopReason(stopReason: string | null): LlmFinishReason {
  switch (stopReason) {
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case 'refusal':
      return 'content_filter';
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_use':
    case 'pause_turn':
    default:
      return 'stop';
  }
}

/**
 * TASK-INFRA-AI-REAL-001 — the real `LlmProvider` implementation (Chapter 3
 * §3.16.1's Shared Adapter Pattern; Chapter 4 §4.16's "structured output is
 * enforced via the LLM provider's native structured-output/tool-use/
 * function-calling capability, not free-text parsing"). Uses Claude's
 * native tool-use with a forced `tool_choice` whenever
 * `LlmCompletionRequest.responseSchema` is supplied (always true for
 * TASK-AI-001's own caller, `ValidateStructuredAiOutputUseCase`) — never
 * asks the model for "JSON in a text response" and regex/string-parses it.
 *
 * The forced tool's parsed `input` (already a JS object per the SDK) is
 * re-serialized to a JSON string for `LlmCompletionResult.content`, so
 * `ValidateStructuredAiOutputUseCase`'s existing `JSON.parse(completion.content)`
 * call continues to work completely unchanged — this adapter satisfies
 * §4.16's tool-use requirement internally without altering the existing
 * provider-neutral port contract (`content: string`) at all.
 *
 * Retry/circuit-breaking is NOT implemented here — `RetryingLlmProvider`/
 * `CircuitBreakerLlmProvider` (TASK-INFRA-010) already own that, composed
 * around this class by `LlmProviderModule`. The Anthropic SDK client this
 * class is constructed with must be configured with `maxRetries: 0` by its
 * caller so the SDK's own internal retry never doubles up with
 * `RetryingLlmProvider`'s.
 */
export class AnthropicLlmProvider implements LlmProvider {
  constructor(
    private readonly client: Anthropic,
    /** The `timeout` the client was configured with (ms) — surfaced on `LlmProviderTimeoutError`, since the SDK's own timeout error doesn't carry it back out. */
    private readonly timeoutMs: number,
  ) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const useTool = request.responseSchema !== undefined;

    let response: Anthropic.Messages.Message;
    try {
      response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        temperature: request.temperature,
        system: request.systemInstructions,
        messages: toAnthropicMessages(request.messages),
        ...(useTool
          ? {
              tools: [
                {
                  name: STRUCTURED_OUTPUT_TOOL_NAME,
                  description:
                    'Return the extracted result. You must call this tool exactly once with output matching its input schema.',
                  input_schema: request.responseSchema as Anthropic.Messages.Tool.InputSchema,
                },
              ],
              tool_choice: {
                type: 'tool',
                name: STRUCTURED_OUTPUT_TOOL_NAME,
              } as Anthropic.Messages.ToolChoice,
            }
          : {}),
      });
    } catch (error) {
      throw this.mapError(error);
    }

    return this.parseResponse(response, useTool);
  }

  private parseResponse(
    response: Anthropic.Messages.Message,
    useTool: boolean,
  ): LlmCompletionResult {
    const finishReason = mapStopReason(response.stop_reason);
    const content = useTool ? this.extractToolOutput(response) : this.extractTextOutput(response);

    return {
      content,
      finishReason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private extractToolOutput(response: Anthropic.Messages.Message): string {
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === 'tool_use' && block.name === STRUCTURED_OUTPUT_TOOL_NAME,
    );
    if (!toolUseBlock) {
      // Never logs `response.content` — it may echo back raw user financial text (Chapter 16 §16.3).
      throw new LlmProviderMalformedResponseError(PROVIDER_NAME);
    }
    try {
      return JSON.stringify(toolUseBlock.input);
    } catch {
      throw new LlmProviderMalformedResponseError(PROVIDER_NAME);
    }
  }

  private extractTextOutput(response: Anthropic.Messages.Message): string {
    const textBlock = response.content.find(
      (block): block is Anthropic.Messages.TextBlock => block.type === 'text',
    );
    if (!textBlock) {
      throw new LlmProviderMalformedResponseError(PROVIDER_NAME);
    }
    return textBlock.text;
  }

  private mapError(error: unknown): Error {
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      return new LlmProviderAuthenticationError(PROVIDER_NAME);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return new LlmProviderRateLimitError(PROVIDER_NAME, this.extractRetryAfterMs(error));
    }
    // Must precede the APIConnectionError check below — APIConnectionTimeoutError extends it.
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new LlmProviderTimeoutError(PROVIDER_NAME, this.timeoutMs);
    }
    if (
      error instanceof Anthropic.BadRequestError ||
      error instanceof Anthropic.UnprocessableEntityError ||
      error instanceof Anthropic.NotFoundError
    ) {
      return new LlmProviderInvalidRequestError(PROVIDER_NAME, error.message);
    }
    if (error instanceof Anthropic.APIError) {
      // InternalServerError, ConflictError, APIConnectionError (network down), and any
      // other/future APIError subclass this adapter doesn't special-case — all treated
      // as a transient availability problem, the safe default for "retryable" (matches
      // RetryingLlmProvider's own exclusion list: only Authentication/InvalidRequest
      // are excluded from retry).
      return new LlmProviderUnavailableError(PROVIDER_NAME);
    }
    // A genuinely unexpected, non-SDK error (e.g. a bug in this adapter itself).
    return new LlmProviderUnavailableError(PROVIDER_NAME);
  }

  /** `Anthropic.RateLimitError` as a type resolves to a response-*shape* type via the SDK's own namespace re-export, not the error class — `InstanceType<typeof ...>` recovers the actual thrown-instance type. */
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
