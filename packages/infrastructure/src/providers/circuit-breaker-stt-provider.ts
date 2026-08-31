import { SttProviderUnavailableError } from '@afa/domain';
import type { SttProvider, SttTranscriptionRequest, SttTranscriptionResult } from '@afa/domain';

export interface SttCircuitBreakerPolicy {
  failureThreshold: number;
  cooldownMs: number;
}

export const DEFAULT_STT_CIRCUIT_BREAKER_POLICY: SttCircuitBreakerPolicy = {
  failureThreshold: 5,
  cooldownMs: 30_000,
};

export type SttCircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * §3.14.2's circuit breaker (referenced for STT specifically by NFR-STT-003
 * "≥99.5% availability, with fallback per Chapter 4 §4.9"), applied to the
 * `SttProvider` port. Same state machine as `CircuitBreakerLlmProvider`
 * (TASK-INFRA-010) — mirrored, not redesigned:
 *
 *   Closed --(failure count exceeds threshold)--> Open
 *   Open --(cooldown elapses)--> HalfOpen
 *   HalfOpen --(probe succeeds)--> Closed
 *   HalfOpen --(probe fails)--> Open
 */
export class CircuitBreakerSttProvider implements SttProvider {
  private state: SttCircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly delegate: SttProvider,
    private readonly providerName: string,
    private readonly policy: SttCircuitBreakerPolicy = DEFAULT_STT_CIRCUIT_BREAKER_POLICY,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult> {
    if (this.state === 'open') {
      if (this.openedAt !== null && this.now() - this.openedAt >= this.policy.cooldownMs) {
        this.state = 'half-open';
      } else {
        throw new SttProviderUnavailableError(this.providerName);
      }
    }

    try {
      const result = await this.delegate.transcribe(request);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  getState(): SttCircuitBreakerState {
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
