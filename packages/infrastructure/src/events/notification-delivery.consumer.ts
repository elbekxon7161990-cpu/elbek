import { Inject, Injectable } from '@nestjs/common';
import {
  computeQuietHoursWindowEnd,
  isWithinQuietHours,
  NOTIFICATION_DEDUP_REPOSITORY,
  NOTIFICATION_DELIVERY_QUEUE,
  NOTIFICATION_PREFERENCE_REPOSITORY,
  NOTIFICATION_REPOSITORY,
  parseBudgetThresholdCrossedPayload,
  parseDebtReminderPayload,
  parseDebtSettledPayload,
  renderBudgetThresholdCrossedMessage,
  renderDebtDueApproachingMessage,
  renderDebtOverdueMessage,
  renderDebtSettledMessage,
  resolveReplyLanguage,
  toDetectedLanguage,
  USER_REPOSITORY,
  type DetectedLanguage,
  type DomainEventConsumer,
  type DomainEventRecord,
  type NotificationDedupRepository,
  type NotificationDeliveryQueue,
  type NotificationPreferenceRepository,
  type NotificationRepository,
  type UserRepository,
} from '@afa/domain';
import { runWithUserContext } from '@afa/shared';

/**
 * TASK-BOT-009-FIX — per-`eventType` dedup cadence, replacing the earlier
 * uniform 24h window (a real, discovered bug: `DebtDueApproaching`'s own
 * producer-side window, `record-debt-reminder-events.use-case.ts`'s
 * `APPROACHING_DEDUP_WINDOW_MS`, is 20h — shorter than the old 24h consumer
 * window — meaning a legitimate T-0/"due today" notification arriving
 * 20–24h after the T-1/"1 day before" one could be incorrectly suppressed
 * as a false-positive repeat).
 *
 * These values MUST match `record-debt-reminder-events.use-case.ts`'s own
 * `APPROACHING_DEDUP_WINDOW_MS`/`OVERDUE_DEDUP_WINDOW_MS` exactly — kept as
 * separate constants (not a shared import) only because `packages/
 * infrastructure` must never depend on `@afa/application`
 * (`package.json`'s own package-boundary description) and the Debt
 * Reminder Producer's own file is explicitly out of this fix's scope to
 * modify (moving these to `@afa/domain`, the one location both layers
 * could safely import from, would require editing the producer's own
 * import — not done here). If either producer or consumer value ever
 * changes, both must be updated together; there is no automated guard
 * against drift beyond this comment and the cross-referencing tests in
 * both files.
 */
const APPROACHING_DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000; // 20 hours — FR-DBT-007's own "1 day before / on the due date" pair
const OVERDUE_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — FR-DBT-007's own "recurring, default weekly"

/**
 * `DebtSettled` has no PRD-specified cadence at all — and structurally
 * cannot need one: a debt's `status` can only transition out of `'open'`
 * once (`PrismaDebtRepository.logRepayment()`/`forgive()`'s own atomic
 * conditional `WHERE status = 'open'` guards — a second attempt returns
 * `null` and emits nothing), so a genuine second `DebtSettled` for the
 * same debt can never occur. This value is not a business cadence at all —
 * it exists purely as a defensive guard against a pathological *retry-
 * redelivery of the identical underlying domain event* (e.g. a transient
 * consumer failure FR-DB-015 retries), the exact case FR-FIN-048's own
 * "safe to process more than once" requirement anticipates. Any short
 * value serves this purpose equally well; 1 hour is not itself PRD-derived
 * or otherwise significant.
 */
const DEBT_SETTLED_DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour — defensive only, not a cadence; see doc comment above

/**
 * TASK-FIN-003 — `BudgetThresholdCrossed` can never legitimately recur for
 * the same `(budgetId, thresholdPercent, periodStart)` triple: the
 * PRODUCER side (`evaluateBudgetThresholdsOnExpenseCommit`,
 * `@afa/infrastructure`) already enforces this via `BudgetNotificationLog`'s
 * own unique constraint BEFORE emitting the event at all — by the time this
 * consumer ever sees the event, it is guaranteed to be a genuinely new
 * crossing, never a re-crossing. This dedup window exists purely as the
 * same defensive backstop `DEBT_SETTLED_DEDUP_WINDOW_MS` already
 * establishes — a guard against *event redelivery* (FR-DB-015 retrying a
 * transiently-failed dispatch), not a business cadence. `dedupKey` is
 * therefore the full `(budgetId, thresholdPercent, periodStart)` triple
 * (`gateAndDeliver`'s caller builds it), not `budgetId` alone — two
 * DIFFERENT thresholds crossed for the same budget in the same period are
 * two DIFFERENT legitimate notifications, never each other's duplicate.
 */
const BUDGET_THRESHOLD_DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour — defensive only, not a cadence

/** §7.9.4's Settings Inventory row for debt due-date reminders — the single toggle covering the approaching, overdue, and settled cases, per §10.1.4's own single "Debt due reminder" row (§8.22.2 additionally marks `DebtSettled` "Consumed By: Chapter 10" without a dedicated preference row of its own — treated as the same debt-notification category rather than an invented, undocumented third toggle). */
const DEBT_REMINDER_PREFERENCE_KEY = 'notif_debt_reminder';

/** Chapter 7 §7.4.4's Settings Inventory — "Budget alerts, debt reminders, weekly summary, subscription renewal alerts — each independently toggleable" — Budget alerts is its OWN preference, distinct from `DEBT_REMINDER_PREFERENCE_KEY` (unlike Debt's three event types, which the PRD groups under one row, Budget gets its own row explicitly). */
const BUDGET_ALERT_PREFERENCE_KEY = 'notif_budget_alert';

/**
 * TASK-BOT-009-FIX — the one seam this fix adds: which dedup window
 * applies to which debt-notification event type. `default` throws rather
 * than silently falling back to some value — `gateAndDeliver` (the only
 * caller) is only ever invoked from the three handler methods below, each
 * passing its own already-known `event.eventType`, so an unrecognized
 * value here would mean a genuine programming error (a fourth handler
 * added without updating this function), not a real runtime condition to
 * degrade gracefully for.
 */
function dedupWindowMsFor(eventType: string): number {
  switch (eventType) {
    case 'DebtDueApproaching':
      return APPROACHING_DEDUP_WINDOW_MS;
    case 'DebtOverdue':
      return OVERDUE_DEDUP_WINDOW_MS;
    case 'DebtSettled':
      return DEBT_SETTLED_DEDUP_WINDOW_MS;
    case 'BudgetThresholdCrossed':
      return BUDGET_THRESHOLD_DEDUP_WINDOW_MS;
    default:
      throw new Error(`No dedup window policy defined for event type "${eventType}".`);
  }
}

/** TASK-FIN-003 — mirrors `dedupWindowMsFor`'s own per-`eventType` lookup shape, now needed because Budget introduces a SECOND preference key (`BUDGET_ALERT_PREFERENCE_KEY`) distinct from the three Debt event types' shared one. */
function preferenceKeyFor(eventType: string): string {
  switch (eventType) {
    case 'DebtDueApproaching':
    case 'DebtOverdue':
    case 'DebtSettled':
      return DEBT_REMINDER_PREFERENCE_KEY;
    case 'BudgetThresholdCrossed':
      return BUDGET_ALERT_PREFERENCE_KEY;
    default:
      throw new Error(`No preference key defined for event type "${eventType}".`);
  }
}

/**
 * TASK-BOT-009 (§10.6.2) — the fast, in-transaction half of notification
 * delivery. Runs inside FR-DB-015's own dispatcher claim transaction
 * (`DomainEventConsumer.handle`'s own contract), so every step here must
 * stay DB-read/write only — no Telegram call, no other slow network
 * operation (see `notification-delivery-queue.repository.ts`'s own doc
 * comment for why that's a hard architectural boundary, not a style
 * choice).
 *
 * Gate order is FR-NOT-007's own literal requirement: preference, then
 * dedup/throttle, then quiet-hours — all three before message formatting.
 * A preference-disabled or dedup-suppressed event produces no
 * `Notification` row and no delivery job at all — never a
 * silently-created-then-immediately-discarded one.
 *
 * No real producer emits `DebtDueApproaching`/`DebtOverdue`/`DebtSettled`
 * yet (this task does not add one — see its own final report) — every
 * method here is exercised in this task's own tests via manually-seeded
 * `domain_events` rows, the same honest convention `PrismaDomainEventRepository.
 * dispatch.integration.spec.ts` already established before TASK-DB-009 added
 * FR-DB-015's own first real consumer.
 */
@Injectable()
export class NotificationDeliveryConsumer {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(NOTIFICATION_PREFERENCE_REPOSITORY)
    private readonly preferenceRepository: NotificationPreferenceRepository,
    @Inject(NOTIFICATION_DEDUP_REPOSITORY)
    private readonly dedupRepository: NotificationDedupRepository,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    @Inject(NOTIFICATION_DELIVERY_QUEUE)
    private readonly deliveryQueue: NotificationDeliveryQueue,
  ) {}

  async handleDebtDueApproaching(event: DomainEventRecord): Promise<void> {
    const payload = parseDebtReminderPayload(event.payload);
    await this.gateAndDeliver(payload.userId, event.eventType, payload.debtId, (language) =>
      renderDebtDueApproachingMessage(payload, language),
    );
  }

  async handleDebtOverdue(event: DomainEventRecord): Promise<void> {
    const payload = parseDebtReminderPayload(event.payload);
    await this.gateAndDeliver(payload.userId, event.eventType, payload.debtId, (language) =>
      renderDebtOverdueMessage(payload, language),
    );
  }

  async handleDebtSettled(event: DomainEventRecord): Promise<void> {
    const payload = parseDebtSettledPayload(event.payload);
    await this.gateAndDeliver(payload.userId, event.eventType, payload.debtId, (language) =>
      renderDebtSettledMessage(payload, language),
    );
  }

  /**
   * TASK-FIN-003 — `dedupKey` is the full `(budgetId, thresholdPercent,
   * periodStart)` triple, not `budgetId` alone (see
   * `BUDGET_THRESHOLD_DEDUP_WINDOW_MS`'s own doc comment for why: two
   * different thresholds crossed for the same budget in the same period
   * are two different legitimate notifications).
   */
  async handleBudgetThresholdCrossed(event: DomainEventRecord): Promise<void> {
    const payload = parseBudgetThresholdCrossedPayload(event.payload);
    const dedupKey = `${payload.budgetId}:${payload.thresholdPercent}:${payload.periodStart}`;
    await this.gateAndDeliver(payload.userId, event.eventType, dedupKey, (language) =>
      renderBudgetThresholdCrossedMessage(payload, language),
    );
  }

  /**
   * Shared by all three handlers: resolve the user, run the preference and
   * dedup gates (FR-NOT-007's required order, before any formatting), then
   * render + persist + enqueue. A missing user, a disabled preference, or a
   * dedup hit all end the same way — no `Notification` row, no delivery
   * job — the only difference between them is *why*, which is not
   * observable to FR-DB-015's own dispatcher either way (this method
   * always completes successfully; none of these are retryable failures).
   */
  private async gateAndDeliver(
    userId: string,
    eventType: string,
    dedupKey: string,
    renderMessage: (language: DetectedLanguage) => string,
  ): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return;
    }

    const enabled = await runWithUserContext(userId, () =>
      this.preferenceRepository.isEnabled(userId, preferenceKeyFor(eventType)),
    );
    if (!enabled) {
      // §13.9's own `status` CHECK constraint already anticipates this
      // exact case (`'suppressed'`, alongside `'queued'`/`'sent'`/
      // `'failed'`) — recorded, not silently dropped, per §10.6.4's own
      // "every step is auditable independently" worked example. FR-NOT-007
      // — never rendered (`message: ''`), since a suppressed notification
      // must never incur the cost of formatting.
      await this.recordSuppressed(userId, eventType, dedupKey, 'preference_disabled');
      return;
    }

    // `NotificationDedupRepository` reads `notifications`, also
    // RLS-protected — scoped the same way as the preference read above.
    const alreadyNotified = await runWithUserContext(userId, () =>
      this.dedupRepository.wasRecentlyNotified(
        userId,
        eventType,
        dedupKey,
        new Date(),
        dedupWindowMsFor(eventType),
      ),
    );
    if (alreadyNotified) {
      await this.recordSuppressed(userId, eventType, dedupKey, 'dedup');
      return;
    }

    const language = resolveReplyLanguage(toDetectedLanguage(user.preferredLanguage), null);
    const message = renderMessage(language);

    const now = new Date();
    // FR-NOT-003/§10.6.6 — a notification that would fire within quiet
    // hours queues until the window's end rather than delivering
    // immediately.
    const readyToDeliverAt = isWithinQuietHours(now, user.timezone)
      ? computeQuietHoursWindowEnd(now, user.timezone)
      : now;

    const notification = await runWithUserContext(userId, () =>
      this.notificationRepository.create({
        userId,
        type: eventType,
        message,
        dedupKey,
        readyToDeliverAt,
      }),
    );

    await this.deliveryQueue.enqueue(notification.id, userId, readyToDeliverAt);
  }

  private async recordSuppressed(
    userId: string,
    eventType: string,
    dedupKey: string,
    reason: 'preference_disabled' | 'dedup',
  ): Promise<void> {
    await runWithUserContext(userId, () =>
      this.notificationRepository.create({
        userId,
        type: eventType,
        message: '',
        dedupKey,
        readyToDeliverAt: new Date(),
        status: 'suppressed',
        suppressedReason: reason,
      }),
    );
  }
}

/**
 * The `DOMAIN_EVENT_CONSUMERS` registry entries this task adds — see
 * `domain-event-consumer-registry.module.ts` for where these are bound.
 * Mirrors `buildTransactionEventCacheInvalidationConsumers`'s own exact
 * shape (TASK-DB-009). TASK-FIN-003 adds the fourth entry,
 * `BudgetThresholdCrossed`.
 */
export function buildNotificationDeliveryConsumers(
  handler: NotificationDeliveryConsumer,
): DomainEventConsumer[] {
  return [
    { eventType: 'DebtDueApproaching', handle: (event) => handler.handleDebtDueApproaching(event) },
    { eventType: 'DebtOverdue', handle: (event) => handler.handleDebtOverdue(event) },
    { eventType: 'DebtSettled', handle: (event) => handler.handleDebtSettled(event) },
    {
      eventType: 'BudgetThresholdCrossed',
      handle: (event) => handler.handleBudgetThresholdCrossed(event),
    },
  ];
}
