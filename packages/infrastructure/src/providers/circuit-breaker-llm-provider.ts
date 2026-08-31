import { LlmProviderUnavailableError } from '@afa/domain';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '@afa/domain';

export interface CircuitBreakerPolicy {
  /** Consecutive failures before the circuit opens (§3.14.2 "failure count exceeds threshold"). */
  failureThreshold: number;
  /** Cooldown before an Open circuit allows a single Half-Open probe call. */
  cooldownMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_POLICY: CircuitBreakerPolicy = {
  failureThreshold: 5,
  cooldownMs: 30_000,
};

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * §3.14.2's circuit breaker, applied per-provider ("configured
 * independently per provider so one provider's outage does not trip the
 * breaker for an unrelated provider" — hence a separate instance per
 * wrapped `LlmProvider`, not a shared/global breaker). State machine
 * exactly as specified:
 *
 *   Closed --(failure count exceeds threshold)--> Open
 *   Open --(cooldown elapses)--> HalfOpen
 *   HalfOpen --(probe succeeds)--> Closed
 *   HalfOpen --(probe fails)--> Open
 *   Closed --(call succeeds)--> Closed (failure count resets)
 */
export class CircuitBreakerLlmProvider implements LlmProvider {
  private state: CircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly delegate: LlmProvider,
    private readonly providerName: string,
    private readonly policy: CircuitBreakerPolicy = DEFAULT_CIRCUIT_BREAKER_POLICY,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (this.state === 'open') {
      if (this.openedAt !== null && this.now() - this.openedAt >= this.policy.cooldownMs) {
        this.state = 'half-open';
      } else {
        // Open — "calls fail immediately without attempting the provider"
        // (§3.14.2), never reaching `this.delegate` at all.
        throw new LlmProviderUnavailableError(this.providerName);
      }
    }

    try {
      const result = await this.delegate.complete(request);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  private onSuccess(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  private onFailure(): void {
    if (this.state === 'half-open') {
      // "HalfOpen --(probe fails)--> Open" — a single failed probe reopens
      // immediately, without needing to re-accumulate the full threshold.
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
