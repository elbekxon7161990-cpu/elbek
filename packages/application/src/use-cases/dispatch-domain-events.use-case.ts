import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DOMAIN_EVENT_CONSUMER_REGISTRY,
  DOMAIN_EVENT_REPOSITORY,
  type DomainEventConsumerRegistry,
  type DomainEventDispatchDecision,
  type DomainEventRecord,
  type DomainEventRepository,
} from '@afa/domain';

/** FR-DB-015's architecture-decision report: a judgment call, not PRD-mandated — the real, PRD-grounded default lives in `packages/shared`'s `EnvironmentVariables.DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS`; this is only the fallback used when nothing overrides it (direct construction in a test, or a composition root that binds nothing). */
export const DEFAULT_DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS = 5;

/** DI seam for `maxDispatchAttempts` — `@afa/application` must never depend on `@nestjs/config` directly (package.json's own boundary), so the composition root (`apps/worker`) resolves the real, env-configured number and binds it to this token via a factory provider. */
export const DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS = Symbol('DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS');

export type DomainEventDispatchOutcome = 'dispatched' | 'retry' | 'failed' | 'unknown_event_type';

/** Deliberately excludes `payload` — Chapter 16 §16.3 data-minimization discipline (see this task's final report, §14): a log/summary of a dispatch cycle must never carry a financial payload, even one already stored in the database. */
export interface DispatchedEventSummary {
  readonly eventId: string;
  readonly eventType: string;
  readonly outcome: DomainEventDispatchOutcome;
  readonly dispatchAttempts: number;
}

/**
 * FR-DB-015 — the dispatcher's actual policy (consumer lookup, retry-vs-
 * terminal threshold, unknown-event-type handling) lives here, in the
 * application layer; the transactional claim/status-update mechanics live in
 * `DomainEventRepository.dispatchNextPending` (`@afa/infrastructure`) — the
 * same "policy above, mechanics below" split TASK-DB-010 already established
 * for `PrismaTransactionRepository.create()`.
 */
@Injectable()
export class DispatchDomainEventsUseCase {
  constructor(
    @Inject(DOMAIN_EVENT_REPOSITORY) private readonly domainEventRepository: DomainEventRepository,
    @Inject(DOMAIN_EVENT_CONSUMER_REGISTRY)
    private readonly consumerRegistry: DomainEventConsumerRegistry,
    @Optional()
    @Inject(DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS)
    private readonly maxDispatchAttempts: number = DEFAULT_DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS,
  ) {}

  /** One claim, one dispatch decision, one commit (via the repository's own single transaction). `null` means nothing pending was available to claim right now. */
  async dispatchOne(): Promise<DispatchedEventSummary | null> {
    const result = await this.domainEventRepository.dispatchNextPending((event) =>
      this.decide(event),
    );
    if (!result) {
      return null;
    }

    const outcome: DomainEventDispatchOutcome =
      result.decision.outcome === 'failed' && !result.decision.incrementAttempts
        ? 'unknown_event_type'
        : result.decision.outcome;

    return {
      eventId: result.event.id,
      eventType: result.event.eventType,
      outcome,
      dispatchAttempts: result.event.dispatchAttempts,
    };
  }

  /**
   * Up to `batchSize` claims per call (FR-DB-015's batching requirement),
   * each its own short transaction — stops as soon as a claim finds nothing
   * pending, rather than always issuing exactly `batchSize` claim attempts.
   */
  async dispatchBatch(batchSize: number): Promise<DispatchedEventSummary[]> {
    const summaries: DispatchedEventSummary[] = [];
    for (let i = 0; i < batchSize; i += 1) {
      const summary = await this.dispatchOne();
      if (!summary) {
        break;
      }
      summaries.push(summary);
    }
    return summaries;
  }

  private async decide(event: DomainEventRecord): Promise<DomainEventDispatchDecision> {
    const consumer = this.consumerRegistry.getConsumer(event.eventType);
    if (!consumer) {
      // No registered handler for this event type — a terminal condition,
      // not a transient one, so it is never retried, and `dispatch_attempts`
      // stays untouched: this claim was never actually attempted.
      return { outcome: 'failed', incrementAttempts: false };
    }

    try {
      await consumer.handle(event);
      return { outcome: 'dispatched' };
    } catch {
      const attemptsAfterThisFailure = event.dispatchAttempts + 1;
      return attemptsAfterThisFailure >= this.maxDispatchAttempts
        ? { outcome: 'failed', incrementAttempts: true }
        : { outcome: 'retry' };
    }
  }
}
