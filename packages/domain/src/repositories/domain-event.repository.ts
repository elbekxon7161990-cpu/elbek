import type { DomainEventStatus, DomainEventType } from '../events/domain-event';

export const DOMAIN_EVENT_REPOSITORY = Symbol('DOMAIN_EVENT_REPOSITORY');

/** §13.30.2's `domain_events` row. */
export interface DomainEventRecord {
  id: string;
  eventType: DomainEventType;
  payload: Record<string, unknown>;
  status: DomainEventStatus;
  dispatchAttempts: number;
  createdAt: Date;
  dispatchedAt: Date | null;
}

export interface NewDomainEventData {
  eventType: DomainEventType;
  payload: Record<string, unknown>;
}

/**
 * FR-DB-015 — the outcome `DispatchDomainEventsUseCase` (`@afa/application`)
 * hands back to `dispatchNextPending` after running the claimed event
 * through the consumer registry. A plain data type (no behavior), so it
 * carries no Prisma/infrastructure dependency despite driving a
 * transactional write — the decision (retry-vs-terminal threshold, unknown-
 * consumer handling) is application-layer *policy*; only the SQL that
 * applies it lives in infrastructure.
 *
 * `failed.incrementAttempts` distinguishes the two ways a dispatch ends in
 * `failed`: a consumer that threw on what was its final allowed attempt
 * (attempts must increment, so the persisted count reflects that attempt
 * happened) versus an event type with no registered consumer at all (never
 * actually attempted — §9's "do not retry" case — so attempts must stay
 * exactly what they were).
 */
export type DomainEventDispatchDecision =
  | { readonly outcome: 'dispatched' }
  | { readonly outcome: 'retry' }
  | { readonly outcome: 'failed'; readonly incrementAttempts: boolean };

export interface DomainEventDispatchResult {
  readonly event: DomainEventRecord;
  readonly decision: DomainEventDispatchDecision;
}

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary) for `domain_events` (§13.30.2).
 *
 * `record` is a deliberately standalone, non-transactionally-coupled write —
 * it does NOT satisfy `FR-DB-014` (same-database-transaction coupling) on
 * its own, and must never be used by a producer that needs atomicity with
 * another state change. The one producer this task wires up
 * (`TransactionCommitted`, in `PrismaTransactionRepository.create()`) does
 * NOT go through this port for that reason — a Prisma port method cannot
 * accept an already-open transaction client without leaking an
 * infrastructure-specific type into the domain layer (`packages/domain` must
 * never import `@prisma/client`). This port exists as the general-purpose,
 * standalone domain-event storage capability (consistent with every other
 * persisted concept in this codebase getting its own port), ready for a
 * future consumer (FR-DB-015's dispatch worker, explicitly out of this
 * task's scope) to extend with read/claim/mark-dispatched methods.
 *
 * `dispatchNextPending` (FR-DB-015) is that extension. It claims the single
 * oldest `pending` row via Postgres `SELECT ... FOR UPDATE SKIP LOCKED`,
 * invokes `handler` with it while still holding that row lock, then applies
 * whichever status transition `handler`'s returned `DomainEventDispatchDecision`
 * implies — all inside ONE short database transaction. This is deliberately
 * ONE method, not three independent "claim"/"markDispatched"/
 * "recordFailedAttempt" calls on this same injected singleton: three
 * separately-callable methods could not be made to share one open
 * transaction/row-lock without either leaking a Prisma transaction handle
 * across this domain-layer interface (forbidden — `packages/domain` must
 * never import `@prisma/client`) or reopening exactly the claim-then-lose-
 * the-lock race the whole design exists to prevent. `handler` is how the
 * caller's policy (consumer lookup, retry-vs-terminal threshold) reaches
 * inside that held lock without this port needing to know anything about
 * either. Returns `null` when no pending event exists to claim.
 */
export interface DomainEventRepository {
  record(data: NewDomainEventData): Promise<DomainEventRecord>;

  dispatchNextPending(
    handler: (event: DomainEventRecord) => Promise<DomainEventDispatchDecision>,
  ): Promise<DomainEventDispatchResult | null>;
}
