/* global Headers -- global `Headers` (Node 18+ built-in / WHATWG fetch API), same ambient-global gap as `Buffer`/`fetch` elsewhere in this codebase. */
import { describe, expect, it, vi } from 'vitest';
import type { LlmCompletionRequest } from '@afa/domain';
import {
  LlmProviderAuthenticationError,
  LlmProviderInvalidRequestError,
  LlmProviderMalformedResponseError,
  LlmProviderRateLimitError,
  LlmProviderTimeoutError,
  LlmProviderUnavailableError,
} from '@afa/domain';
import Anthropic from '@anthropic-ai/sdk';

import { AnthropicLlmProvider } from './anthropic-llm-provider';

const TIMEOUT_MS = 60_000;

function textRequest(overrides: Partial<LlmCompletionRequest> = {}): LlmCompletionRequest {
  return {
    systemInstructions: 'You are a financial extraction assistant.',
    messages: [{ role: 'user', content: 'spent 45000 on lunch' }],
    model: 'claude-sonnet-5',
    ...overrides,
  };
}

function schemaRequest(overrides: Partial<LlmCompletionRequest> = {}): LlmCompletionRequest {
  return textRequest({
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['transactions'],
      properties: { transactions: { type: 'array' } },
    },
    ...overrides,
  });
}

function textMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    content: [{ type: 'text', text: 'hello' }],
    model: 'claude-sonnet-5',
    role: 'assistant',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

function toolMessage(input: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    content: [{ type: 'tool_use', id: 'tool_1', name: 'extract_structured_output', input }],
    model: 'claude-sonnet-5',
    role: 'assistant',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 15 },
    ...overrides,
  };
}

describe('AnthropicLlmProvider — request mapping', () => {
  it('forwards systemInstructions as `system`', async () => {
    const create = vi.fn().mockResolvedValue(textMessage());
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await provider.complete(textRequest({ systemInstructions: 'be precise' }));

    expect(create.mock.calls[0]![0]).toMatchObject({ system: 'be precise' });
  });

  it('forwards user messages with role/content preserved', async () => {
    const create = vi.fn().mockResolvedValue(textMessage());
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await provider.complete(
      textRequest({
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'ack' },
          { role: 'user', content: 'second' },
        ],
      }),
    );

    expect(create.mock.calls[0]![0]).toMatchObject({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ack' },
        { role: 'user', content: 'second' },
      ],
    });
  });

  it('forwards the model exactly as given (never hardcoded)', async () => {
    const create = vi.fn().mockResolvedValue(textMessage());
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await provider.complete(textRequest({ model: 'claude-opus-5' }));

    expect(create.mock.calls[0]![0]).toMatchObject({ model: 'claude-opus-5' });
  });

  it('forwards temperature when provided', async () => {
    const create = vi.fn().mockResolvedValue(textMessage());
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await provider.complete(textRequest({ temperature: 0.2 }));

    expect(create.mock.calls[0]![0]).toMatchObject({ temperature: 0.2 });
  });

  it('forwards maxOutputTokens as max_tokens when provided', async () => {
    const create = vi.fn().mockResolvedValue(textMessage());
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await provider.complete(textRequest({ maxOutputTokens: 512 }));

    expect(create.mock.calls[0]![0]).toMatchObject({ max_tokens: 512 });
  });

  it('falls back to a default max_tokens when maxOutputTokens is omitted (Anthropic requires the field)', async () => {
    const create = vi.fn().mockResolvedValue(textMessage());
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await provider.complete(textRequest());

    expect(create.mock.calls[0]![0]).toMatchObject({ max_tokens: expect.any(Number) });
  });

  it('does not send tools/tool_choice when responseSchema is absent (plain-text mode)', async () => {
    const create = vi.fn().mockResolvedValue(textMessage());
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await provider.complete(textRequest());

    expect(create.mock.calls[0]![0]).not.toHaveProperty('tools');
    expect(create.mock.calls[0]![0]).not.toHaveProperty('tool_choice');
  });

  it('sends a forced single-tool tool_choice built from responseSchema when present (§4.16 native tool-use, not free-text JSON parsing)', async () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['x'],
      properties: { x: { type: 'string' } },
    };
    const create = vi.fn().mockResolvedValue(toolMessage({ x: 'y' }));
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await provider.complete(schemaRequest({ responseSchema: schema }));

    const params = create.mock.calls[0]![0] as {
      tools: { input_schema: unknown; name: string }[];
      tool_choice: { type: string; name: string };
    };
    expect(params.tools).toHaveLength(1);
    expect(params.tools[0]?.input_schema).toEqual(schema);
    expect(params.tool_choice).toEqual({ type: 'tool', name: params.tools[0]?.name });
  });
});

describe('AnthropicLlmProvider — successful response parsing', () => {
  it('parses a tool_use response, re-serializing input to a JSON string content field', async () => {
    const parsedInput = { transactions: [{ amount: 45000 }] };
    const create = vi.fn().mockResolvedValue(toolMessage(parsedInput));
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    const result = await provider.complete(schemaRequest());

    expect(JSON.parse(result.content)).toEqual(parsedInput);
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 15 });
  });

  it('parses a plain-text response when no schema was requested', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(textMessage({ content: [{ type: 'text', text: 'plain answer' }] }));
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    const result = await provider.complete(textRequest());

    expect(result.content).toBe('plain answer');
  });

  it('maps stop_reason "max_tokens" to finishReason "length"', async () => {
    const create = vi.fn().mockResolvedValue(textMessage({ stop_reason: 'max_tokens' }));
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    const result = await provider.complete(textRequest());

    expect(result.finishReason).toBe('length');
  });

  it('maps stop_reason "refusal" to finishReason "content_filter"', async () => {
    const create = vi.fn().mockResolvedValue(textMessage({ stop_reason: 'refusal' }));
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    const result = await provider.complete(textRequest());

    expect(result.finishReason).toBe('content_filter');
  });

  it('maps stop_reason "end_turn" to finishReason "stop"', async () => {
    const create = vi.fn().mockResolvedValue(textMessage({ stop_reason: 'end_turn' }));
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    const result = await provider.complete(textRequest());

    expect(result.finishReason).toBe('stop');
  });
});

describe('AnthropicLlmProvider — malformed response', () => {
  it('throws LlmProviderMalformedResponseError when a schema was requested but no tool_use block is returned', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(textMessage({ content: [{ type: 'text', text: 'no tool call' }] }));
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(schemaRequest())).rejects.toBeInstanceOf(
      LlmProviderMalformedResponseError,
    );
  });

  it('throws LlmProviderMalformedResponseError when no schema was requested and no text block is returned', async () => {
    const create = vi.fn().mockResolvedValue(textMessage({ content: [] }));
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(textRequest())).rejects.toBeInstanceOf(
      LlmProviderMalformedResponseError,
    );
  });

  it('never includes response content in the thrown error message (Chapter 16 §16.3 data minimization)', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(
        textMessage({ content: [{ type: 'text', text: 'SENSITIVE-FINANCIAL-DATA-12345' }] }),
      );
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(schemaRequest())).rejects.not.toThrow(
      expect.stringContaining('SENSITIVE-FINANCIAL-DATA-12345'),
    );
  });
});

describe('AnthropicLlmProvider — error mapping', () => {
  it('maps a 401 AuthenticationError to LlmProviderAuthenticationError', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        Anthropic.APIError.generate(
          401,
          { type: 'error', error: { type: 'authentication_error', message: 'bad key' } },
          'bad key',
          new Headers(),
        ),
      );
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(textRequest())).rejects.toBeInstanceOf(
      LlmProviderAuthenticationError,
    );
  });

  it('maps a 403 PermissionDeniedError to LlmProviderAuthenticationError', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        Anthropic.APIError.generate(
          403,
          { type: 'error', error: { type: 'permission_error', message: 'forbidden' } },
          'forbidden',
          new Headers(),
        ),
      );
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(textRequest())).rejects.toBeInstanceOf(
      LlmProviderAuthenticationError,
    );
  });

  it('maps a 429 RateLimitError to LlmProviderRateLimitError, reading retry-after', async () => {
    const headers = new Headers({ 'retry-after': '5' });
    const create = vi
      .fn()
      .mockRejectedValue(
        Anthropic.APIError.generate(
          429,
          { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
          'slow down',
          headers,
        ),
      );
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    const error = await provider.complete(textRequest()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmProviderRateLimitError);
    expect((error as InstanceType<typeof LlmProviderRateLimitError>).retryAfterMs).toBe(5000);
  });

  it('maps a 429 RateLimitError with no retry-after header to LlmProviderRateLimitError with an undefined retryAfterMs', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        Anthropic.APIError.generate(
          429,
          { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
          'slow down',
          new Headers(),
        ),
      );
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    const error = await provider.complete(textRequest()).catch((e: unknown) => e);

    expect((error as InstanceType<typeof LlmProviderRateLimitError>).retryAfterMs).toBeUndefined();
  });

  it('maps an APIConnectionTimeoutError to LlmProviderTimeoutError, carrying the configured timeout', async () => {
    const create = vi.fn().mockRejectedValue(new Anthropic.APIConnectionTimeoutError());
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    const error = await provider.complete(textRequest()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmProviderTimeoutError);
    expect((error as Error).message).toContain(String(TIMEOUT_MS));
  });

  it('maps a 400 BadRequestError to LlmProviderInvalidRequestError', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        Anthropic.APIError.generate(
          400,
          { type: 'error', error: { type: 'invalid_request_error', message: 'bad model' } },
          'bad model',
          new Headers(),
        ),
      );
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(textRequest())).rejects.toBeInstanceOf(
      LlmProviderInvalidRequestError,
    );
  });

  it('maps a 422 UnprocessableEntityError to LlmProviderInvalidRequestError', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        Anthropic.APIError.generate(
          422,
          { type: 'error', error: { type: 'invalid_request_error', message: 'unprocessable' } },
          'unprocessable',
          new Headers(),
        ),
      );
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(textRequest())).rejects.toBeInstanceOf(
      LlmProviderInvalidRequestError,
    );
  });

  it('maps a 404 NotFoundError (e.g. unknown model) to LlmProviderInvalidRequestError', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        Anthropic.APIError.generate(
          404,
          { type: 'error', error: { type: 'not_found_error', message: 'unknown model' } },
          'unknown model',
          new Headers(),
        ),
      );
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(textRequest())).rejects.toBeInstanceOf(
      LlmProviderInvalidRequestError,
    );
  });

  it('maps a 500 InternalServerError to LlmProviderUnavailableError', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        Anthropic.APIError.generate(
          500,
          { type: 'error', error: { type: 'api_error', message: 'oops' } },
          'oops',
          new Headers(),
        ),
      );
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(textRequest())).rejects.toBeInstanceOf(
      LlmProviderUnavailableError,
    );
  });

  it('maps a network-level APIConnectionError to LlmProviderUnavailableError', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(new Anthropic.APIConnectionError({ message: 'network down' }));
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(textRequest())).rejects.toBeInstanceOf(
      LlmProviderUnavailableError,
    );
  });

  it('maps a completely unexpected, non-SDK error to LlmProviderUnavailableError rather than letting it propagate raw', async () => {
    const create = vi.fn().mockRejectedValue(new TypeError('something broke'));
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    await expect(provider.complete(textRequest())).rejects.toBeInstanceOf(
      LlmProviderUnavailableError,
    );
  });

  it('never includes the raw provider error message on LlmProviderAuthenticationError (structural secret-leakage guard)', async () => {
    const create = vi.fn().mockRejectedValue(
      Anthropic.APIError.generate(
        401,
        {
          type: 'error',
          error: { type: 'authentication_error', message: 'key sk-ant-SECRET123 is invalid' },
        },
        'key sk-ant-SECRET123 is invalid',
        new Headers(),
      ),
    );
    const provider = new AnthropicLlmProvider(buildClientFromFn(create), TIMEOUT_MS);

    const error = await provider.complete(textRequest()).catch((e: unknown) => e);

    expect((error as Error).message).not.toContain('sk-ant-SECRET123');
  });
});

function buildClientFromFn(create: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { create } } as unknown as Anthropic;
}
