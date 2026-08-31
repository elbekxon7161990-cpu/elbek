import { describe, expect, it } from 'vitest';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  LlmProviderError,
} from '@afa/domain';
import { LlmProviderTimeoutError } from '@afa/domain';

import { ValidateStructuredAiOutputUseCase } from './validate-structured-ai-output.use-case';

interface FakeStep {
  result?: LlmCompletionResult;
  error?: LlmProviderError;
}

/**
 * A local, minimal `LlmProvider` test double. Not imported from
 * `@afa/infrastructure`'s `FakeLlmProvider` — this package's own
 * package.json explicitly forbids depending on `@afa/infrastructure`
 * ("never on @afa/infrastructure directly; the composition root ... binds
 * domain interfaces to infrastructure implementations"), so the boundary
 * holds even in tests.
 */
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
    if (next?.error) {
      throw next.error;
    }
    return next?.result ?? this.defaultResult;
  }

  get callCount(): number {
    return this.calls.length;
  }

  get lastRequest(): LlmCompletionRequest | undefined {
    return this.calls.at(-1);
  }
}

const VALID_CANDIDATE = {
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
  confidenceScores: { intent: 0.98, amount: 0.99 },
};

const VALID_OUTPUT = {
  transactions: [VALID_CANDIDATE],
  detectedLanguage: 'en',
  clarificationNeeded: false,
  clarificationQuestion: null,
};

function resultOf(content: string): LlmCompletionResult {
  return { content, finishReason: 'stop' };
}

const REQUEST: LlmCompletionRequest = {
  messages: [{ role: 'user', content: 'I spent 45000 UZS on lunch' }],
  model: 'test-model',
};

describe('ValidateStructuredAiOutputUseCase', () => {
  it('returns a valid outcome on the first attempt when the provider output already conforms', async () => {
    const provider = new LocalFakeLlmProvider(resultOf(JSON.stringify(VALID_OUTPUT)));
    const useCase = new ValidateStructuredAiOutputUseCase(provider);

    const outcome = await useCase.execute(REQUEST);

    expect(outcome.status).toBe('valid');
    expect(provider.callCount).toBe(1);
  });

  it('retries once with a schema reminder when the first response fails validation, then succeeds', async () => {
    const provider = new LocalFakeLlmProvider(resultOf(JSON.stringify(VALID_OUTPUT)));
    provider.enqueue({ result: resultOf(JSON.stringify({ transactions: [] })) });
    const useCase = new ValidateStructuredAiOutputUseCase(provider);

    const outcome = await useCase.execute(REQUEST);

    expect(outcome.status).toBe('valid');
    expect(provider.callCount).toBe(2);
    expect(provider.lastRequest?.systemInstructions).toContain(
      'did not conform to the required JSON schema',
    );
  });

  it('escalates to status "unknown" (never throws) when both the original and retry attempts fail validation', async () => {
    const provider = new LocalFakeLlmProvider(resultOf('{"transactions": []}'));
    provider.enqueue({ result: resultOf('{"transactions": []}') });
    provider.enqueue({ result: resultOf('{"transactions": []}') });
    const useCase = new ValidateStructuredAiOutputUseCase(provider);

    const outcome = await useCase.execute(REQUEST);

    expect(outcome.status).toBe('unknown');
    expect(provider.callCount).toBe(2);
    if (outcome.status === 'unknown') {
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
  });

  it('escalates to "unknown" when the provider response is not valid JSON at all (unexpected text)', async () => {
    const provider = new LocalFakeLlmProvider(
      resultOf('Sure! Here is your answer: I spent some money today.'),
    );
    const useCase = new ValidateStructuredAiOutputUseCase(provider);

    const outcome = await useCase.execute(REQUEST);

    expect(outcome.status).toBe('unknown');
    if (outcome.status === 'unknown') {
      expect(outcome.reason).toContain('not valid JSON');
    }
  });

  it('escalates to "unknown" when the provider response is malformed JSON', async () => {
    const provider = new LocalFakeLlmProvider(resultOf('{"transactions": [ this is not json'));
    const useCase = new ValidateStructuredAiOutputUseCase(provider);

    const outcome = await useCase.execute(REQUEST);

    expect(outcome.status).toBe('unknown');
  });

  it('never persists, never touches a repository, and never calls a real LLM API — provider is the only collaborator', async () => {
    const provider = new LocalFakeLlmProvider(resultOf(JSON.stringify(VALID_OUTPUT)));
    const useCase = new ValidateStructuredAiOutputUseCase(provider);

    await useCase.execute(REQUEST);

    expect(provider.lastRequest?.model).toBe('test-model');
  });

  it("propagates LlmProviderError subclasses uncaught — provider-call failures are TASK-INFRA-010's resilience concern, not this use case's", async () => {
    const provider = new LocalFakeLlmProvider(resultOf(JSON.stringify(VALID_OUTPUT)));
    provider.enqueue({ error: new LlmProviderTimeoutError('fake-provider', 5000) });
    const useCase = new ValidateStructuredAiOutputUseCase(provider);

    await expect(useCase.execute(REQUEST)).rejects.toBeInstanceOf(LlmProviderTimeoutError);
    expect(provider.callCount).toBe(1);
  });

  it('requests the structured extraction JSON schema on every attempt via responseSchema', async () => {
    const provider = new LocalFakeLlmProvider(resultOf('not json'));
    provider.enqueue({ result: resultOf('still not json') });
    const useCase = new ValidateStructuredAiOutputUseCase(provider);

    await useCase.execute(REQUEST);

    expect(provider.lastRequest?.responseSchema).toBeDefined();
  });
});
