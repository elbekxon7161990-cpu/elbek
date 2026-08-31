import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  LlmProviderError,
} from '@afa/domain';

export interface FakeLlmProviderStep {
  result?: LlmCompletionResult;
  error?: LlmProviderError;
}

/**
 * A scriptable `LlmProvider` test double — NOT a real provider, never
 * wired into any production DI module. Exists for two reasons:
 *
 * 1. TASK-INFRA-010's own Definition of Done: "swapping a provider
 *    implementation requires changes only within its adapter, verified by
 *    a deliberate provider-swap exercise in a test double" — this is that
 *    test double, and `llm-provider-swap.spec.ts` is that exercise.
 * 2. A reusable fixture for TASK-AI-001+'s own future tests, so each
 *    doesn't need to hand-roll its own fake `LlmProvider`.
 *
 * Scripted responses are consumed in order via `enqueue`; once the script
 * is exhausted, `defaultResult` is returned for every subsequent call.
 */
export class FakeLlmProvider implements LlmProvider {
  private readonly calls: LlmCompletionRequest[] = [];
  private readonly script: FakeLlmProviderStep[] = [];

  constructor(private readonly defaultResult: LlmCompletionResult) {}

  enqueue(step: FakeLlmProviderStep): this {
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
