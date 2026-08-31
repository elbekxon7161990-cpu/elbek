import { OcrProviderUnavailableError } from '@afa/domain';
import type { OcrExtractionRequest, OcrExtractionResult, OcrProvider } from '@afa/domain';

export interface OcrCircuitBreakerPolicy {
  failureThreshold: number;
  cooldownMs: number;
}

export const DEFAULT_OCR_CIRCUIT_BREAKER_POLICY: OcrCircuitBreakerPolicy = {
  failureThreshold: 5,
  cooldownMs: 30_000,
};

export type OcrCircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * §3.14.2's circuit breaker, applied to the `OcrProvider` port. Same state
 * machine as `CircuitBreakerSttProvider`/`CircuitBreakerLlmProvider` —
 * mirrored, not redesigned.
 */
export class CircuitBreakerOcrProvider implements OcrProvider {
  private state: OcrCircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly delegate: OcrProvider,
    private readonly providerName: string,
    private readonly policy: OcrCircuitBreakerPolicy = DEFAULT_OCR_CIRCUIT_BREAKER_POLICY,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async extractText(request: OcrExtractionRequest): Promise<OcrExtractionResult> {
    if (this.state === 'open') {
      if (this.openedAt !== null && this.now() - this.openedAt >= this.policy.cooldownMs) {
        this.state = 'half-open';
      } else {
        throw new OcrProviderUnavailableError(this.providerName);
      }
    }

    try {
      const result = await this.delegate.extractText(request);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  getState(): OcrCircuitBreakerState {
    return this.state;
  }

  private onSuccess(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  private onFailure(): void {
    if (this.state === 'half-open') {
      this.state = 'open';
      this.openedAt = this.now();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.policy.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}
