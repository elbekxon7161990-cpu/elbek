import type {
  SttProvider,
  SttProviderError,
  SttTranscriptionRequest,
  SttTranscriptionResult,
} from '@afa/domain';

export interface FakeSttProviderStep {
  result?: SttTranscriptionResult;
  error?: SttProviderError;
}

/**
 * A scriptable `SttProvider` test double — not a real provider. Mirrors
 * `FakeLlmProvider`'s established shape (TASK-INFRA-010) for the same two
 * reasons: proving the provider-swap DoD or, here, that STT provider
 * swapping works identically, and giving this task's own tests a reusable,
 * deterministic fixture rather than a hand-rolled fake per test file.
 *
 * TASK-MVP-002 — also wired into `apps/telegram-bot`'s
 * `EnvironmentBlockedProvidersModule` as a temporary, loudly-logged
 * placeholder (no real STT adapter exists yet) — without it, the app could
 * not boot at all, since `TranscribeVoiceMessageUseCase` unconditionally
 * needs an `STT_PROVIDER` binding. That composition-root usage always
 * supplies a fixed, zero-confidence default result, never a fabricated
 * transcript.
 */
export class FakeSttProvider implements SttProvider {
  private readonly calls: SttTranscriptionRequest[] = [];
  private readonly script: FakeSttProviderStep[] = [];

  constructor(private readonly defaultResult: SttTranscriptionResult) {}

  enqueue(step: FakeSttProviderStep): this {
    this.script.push(step);
    return this;
  }

  async transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult> {
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

  get lastRequest(): SttTranscriptionRequest | undefined {
    return this.calls.at(-1);
  }
}
