import type {
  OcrExtractionRequest,
  OcrExtractionResult,
  OcrProvider,
  OcrProviderError,
} from '@afa/domain';

export interface FakeOcrProviderStep {
  result?: OcrExtractionResult;
  error?: OcrProviderError;
}

/**
 * A scriptable `OcrProvider` test double — not a real provider. Mirrors
 * `FakeSttProvider`'s/`FakeLlmProvider`'s established shape.
 *
 * TASK-MVP-002 — also wired into `apps/telegram-bot`'s
 * `EnvironmentBlockedProvidersModule` as a temporary, loudly-logged
 * placeholder (no real OCR adapter exists yet) — without it, the app could
 * not boot at all, since `ProcessReceiptImageUseCase` unconditionally needs
 * an `OCR_PROVIDER` binding. That composition-root usage always supplies a
 * fixed, zero-confidence default result, never fabricated receipt text.
 */
export class FakeOcrProvider implements OcrProvider {
  private readonly calls: OcrExtractionRequest[] = [];
  private readonly script: FakeOcrProviderStep[] = [];

  constructor(private readonly defaultResult: OcrExtractionResult) {}

  enqueue(step: FakeOcrProviderStep): this {
    this.script.push(step);
    return this;
  }

  async extractText(request: OcrExtractionRequest): Promise<OcrExtractionResult> {
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

  get lastRequest(): OcrExtractionRequest | undefined {
    return this.calls.at(-1);
  }
}
