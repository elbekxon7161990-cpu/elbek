import { describe, expect, it } from 'vitest';
import type { LlmCompletionRequest } from '@afa/domain';
import Anthropic from '@anthropic-ai/sdk';

import { AnthropicLlmProvider } from './anthropic-llm-provider';

/**
 * TASK-INFRA-AI-REAL-001's real-provider smoke test. Unlike this repo's
 * Prisma/Redis integration specs (which assume a local dev dependency that
 * *should* be running and fail loudly if it isn't), there is no local
 * default for a paid cloud LLM API — hitting it by default on every test
 * run would cost real money for no benefit. This suite is therefore
 * skipped (not failed) when `ANTHROPIC_API_KEY` is unset, and runs one
 * minimal, cheap real call when it is.
 *
 * REAL_LLM_PROVIDER_TEST = ENVIRONMENT-BLOCKED in this sandbox — no
 * `ANTHROPIC_API_KEY` is configured here, so this suite is skipped, not
 * fabricated as passing.
 */
describe.skipIf(!process.env.ANTHROPIC_API_KEY)(
  'AnthropicLlmProvider (real API smoke test)',
  () => {
    it('completes a trivial plain-text request against the real Anthropic API', async () => {
      const client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        maxRetries: 0,
        timeout: 30_000,
      });
      const provider = new AnthropicLlmProvider(client, 30_000);
      const request: LlmCompletionRequest = {
        messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
        maxOutputTokens: 16,
      };

      const result = await provider.complete(request);

      expect(result.content.toLowerCase()).toContain('pong');
      expect(result.finishReason).toBe('stop');
    });

    it('completes a tool-use (structured output) request against the real Anthropic API', async () => {
      const client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        maxRetries: 0,
        timeout: 30_000,
      });
      const provider = new AnthropicLlmProvider(client, 30_000);
      const request: LlmCompletionRequest = {
        messages: [{ role: 'user', content: 'The number is 42.' }],
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
        maxOutputTokens: 64,
        responseSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['value'],
          properties: { value: { type: 'number' } },
        },
      };

      const result = await provider.complete(request);
      const parsed = JSON.parse(result.content) as { value: number };

      expect(parsed.value).toBe(42);
    });
  },
);
