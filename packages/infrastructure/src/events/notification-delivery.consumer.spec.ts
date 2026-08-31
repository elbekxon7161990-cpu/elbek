import { describe, expect, it, vi } from 'vitest';
import type {
  DomainEventRecord,
  NotificationDedupRepository,
  NotificationDeliveryQueue,
  NotificationPreferenceRepository,
  NotificationRecord,
  NotificationRepository,
  User,
  UserRepository,
} from '@afa/domain';

import {
  buildNotificationDeliveryConsumers,
  NotificationDeliveryConsumer,
} from './notification-delivery.consumer';

function makeEvent(overrides: Partial<DomainEventRecord> = {}): DomainEventRecord {
  return {
    id: 'evt-1',
    eventType: 'DebtDueApproaching',
    payload: {},
    status: 'pending',
    dispatchAttempts: 0,
    createdAt: new Date('2026-01-15T00:00:00Z'),
    dispatchedAt: null,
    ...overrides,
  };
}

const DEBT_REMINDER_PAYLOAD = {
  debtId: 'debt-1',
  userId: 'user-1',
  counterpartyName: 'Aziz',
  outstandingBalance: '50000.00',
  currency: 'UZS',
  dueDate: '2026-09-01',
};

const DEBT_SETTLED_PAYLOAD = {
  debtId: 'debt-1',
  userId: 'user-1',
  counterpartyName: 'Aziz',
  status: 'repaid',
};

const BUDGET_THRESHOLD_PAYLOAD = {
  budgetId: 'budget-1',
  userId: 'user-1',
  scopeType: 'category',
  categoryName: 'FOOD_DINING',
  thresholdPercent: 90,
  utilizationPercent: 96,
  limitAmount: '900000.00',
  usedAmount: '864000.00',
  currency: 'RUB',
  periodStart: '2026-08-01',
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    preferredLanguage: 'en',
    timezone: 'UTC',
    ...overrides,
  } as User;
}

interface Fakes {
  userRepository: UserRepository & { findById: ReturnType<typeof vi.fn> };
  preferenceRepository: NotificationPreferenceRepository & { isEnabled: ReturnType<typeof vi.fn> };
  dedupRepository: NotificationDedupRepository & { wasRecentlyNotified: ReturnType<typeof vi.fn> };
  notificationRepository: NotificationRepository & { create: ReturnType<typeof vi.fn> };
  deliveryQueue: NotificationDeliveryQueue & { enqueue: ReturnType<typeof vi.fn> };
}

function makeFakes(): Fakes {
  return {
    userRepository: { findById: vi.fn().mockResolvedValue(makeUser()) } as never,
    preferenceRepository: { isEnabled: vi.fn().mockResolvedValue(true) } as never,
    dedupRepository: { wasRecentlyNotified: vi.fn().mockResolvedValue(false) } as never,
    notificationRepository: {
      create: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          id: 'notification-1',
          status: 'queued',
          suppressedReason: null,
          sentAt: null,
          createdAt: new Date(),
          ...data,
        } as NotificationRecord),
      ),
    } as never,
    deliveryQueue: { enqueue: vi.fn().mockResolvedValue(undefined) } as never,
  };
}

function makeConsumer(fakes: Fakes): NotificationDeliveryConsumer {
  return new NotificationDeliveryConsumer(
    fakes.userRepository,
    fakes.preferenceRepository,
    fakes.dedupRepository,
    fakes.notificationRepository,
    fakes.deliveryQueue,
  );
}

describe('NotificationDeliveryConsumer', () => {
  describe('handleDebtDueApproaching', () => {
    it('persists a notification and enqueues immediate delivery when all gates pass (daytime)', async () => {
      const fakes = makeFakes();
      const consumer = makeConsumer(fakes);
      const event = makeEvent({ eventType: 'DebtDueApproaching', payload: DEBT_REMINDER_PAYLOAD });

      await consumer.handleDebtDueApproaching(event);

      expect(fakes.notificationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'DebtDueApproaching',
          dedupKey: 'debt-1',
        }),
      );
      const [callArgs] = fakes.notificationRepository.create.mock.calls[0]!;
      expect(callArgs.message).toContain('Aziz');
      expect(fakes.deliveryQueue.enqueue).toHaveBeenCalledWith(
        'notification-1',
        'user-1',
        expect.any(Date),
      );
    });

    it('checks preference before dedup (FR-NOT-007 order) — a disabled preference short-circuits before any dedup call, and records an audit-only "suppressed" row with no rendered message (never formatted, per FR-NOT-007)', async () => {
      const fakes = makeFakes();
      fakes.preferenceRepository.isEnabled.mockResolvedValue(false);
      const consumer = makeConsumer(fakes);
      const event = makeEvent({ eventType: 'DebtDueApproaching', payload: DEBT_REMINDER_PAYLOAD });

      await consumer.handleDebtDueApproaching(event);

      expect(fakes.dedupRepository.wasRecentlyNotified).not.toHaveBeenCalled();
      expect(fakes.notificationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'suppressed',
          suppressedReason: 'preference_disabled',
          message: '',
        }),
      );
      expect(fakes.deliveryQueue.enqueue).not.toHaveBeenCalled();
    });

    it('records an audit-only "suppressed" row (never delivered, never enqueued) when the dedup gate reports a recent notification (FR-NOT-009)', async () => {
      const fakes = makeFakes();
      fakes.dedupRepository.wasRecentlyNotified.mockResolvedValue(true);
      const consumer = makeConsumer(fakes);
      const event = makeEvent({ eventType: 'DebtDueApproaching', payload: DEBT_REMINDER_PAYLOAD });

      await consumer.handleDebtDueApproaching(event);

      expect(fakes.notificationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'suppressed', suppressedReason: 'dedup', message: '' }),
      );
      expect(fakes.deliveryQueue.enqueue).not.toHaveBeenCalled();
    });

    it('completes successfully (no throw, no retry) when the referenced user no longer exists', async () => {
      const fakes = makeFakes();
      fakes.userRepository.findById.mockResolvedValue(null);
      const consumer = makeConsumer(fakes);
      const event = makeEvent({ eventType: 'DebtDueApproaching', payload: DEBT_REMINDER_PAYLOAD });

      await expect(consumer.handleDebtDueApproaching(event)).resolves.toBeUndefined();
      expect(fakes.notificationRepository.create).not.toHaveBeenCalled();
    });

    it('queues for later delivery (readyToDeliverAt in the future) when the user is within quiet hours', async () => {
      const fakes = makeFakes();
      fakes.userRepository.findById.mockResolvedValue(
        makeUser({ timezone: 'Asia/Tashkent' }), // UTC+5
      );
      const consumer = makeConsumer(fakes);
      const event = makeEvent({ eventType: 'DebtDueApproaching', payload: DEBT_REMINDER_PAYLOAD });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T18:00:00Z')); // 23:00 Tashkent — within quiet hours
      try {
        await consumer.handleDebtDueApproaching(event);
      } finally {
        vi.useRealTimers();
      }

      const [callArgs] = fakes.notificationRepository.create.mock.calls[0]!;
      expect(callArgs.readyToDeliverAt.getTime()).toBeGreaterThan(
        new Date('2026-01-15T18:00:00Z').getTime(),
      );
      const [, , deliverAt] = fakes.deliveryQueue.enqueue.mock.calls[0]!;
      expect(deliverAt.getTime()).toBe(callArgs.readyToDeliverAt.getTime());
    });

    it('fails safely (throws, never silently no-ops) on a malformed payload', async () => {
      const fakes = makeFakes();
      const consumer = makeConsumer(fakes);
      const event = makeEvent({ eventType: 'DebtDueApproaching', payload: { debtId: 'debt-1' } });

      await expect(consumer.handleDebtDueApproaching(event)).rejects.toThrow(/Malformed/);
      expect(fakes.notificationRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('handleDebtOverdue', () => {
    it('persists a notification with the overdue-specific message', async () => {
      const fakes = makeFakes();
      const consumer = makeConsumer(fakes);
      const event = makeEvent({ eventType: 'DebtOverdue', payload: DEBT_REMINDER_PAYLOAD });

      await consumer.handleDebtOverdue(event);

      const [callArgs] = fakes.notificationRepository.create.mock.calls[0]!;
      expect(callArgs.type).toBe('DebtOverdue');
      expect(callArgs.message).toMatch(/overdue/i);
    });
  });

  describe('handleDebtSettled', () => {
    it('persists a settled notification distinguishing repaid vs forgiven', async () => {
      const fakes = makeFakes();
      const consumer = makeConsumer(fakes);
      const event = makeEvent({ eventType: 'DebtSettled', payload: DEBT_SETTLED_PAYLOAD });

      await consumer.handleDebtSettled(event);

      const [callArgs] = fakes.notificationRepository.create.mock.calls[0]!;
      expect(callArgs.type).toBe('DebtSettled');
      expect(callArgs.message).toMatch(/repaid/i);
    });

    it('rejects an invalid status value', async () => {
      const fakes = makeFakes();
      const consumer = makeConsumer(fakes);
      const event = makeEvent({
        eventType: 'DebtSettled',
        payload: { ...DEBT_SETTLED_PAYLOAD, status: 'open' },
      });

      await expect(consumer.handleDebtSettled(event)).rejects.toThrow(/Malformed/);
    });
  });

  describe('handleBudgetThresholdCrossed (TASK-FIN-003)', () => {
    it('persists a threshold-warning notification with a composite dedupKey (budgetId:thresholdPercent:periodStart)', async () => {
      const fakes = makeFakes();
      const consumer = makeConsumer(fakes);
      const event = makeEvent({
        eventType: 'BudgetThresholdCrossed',
        payload: BUDGET_THRESHOLD_PAYLOAD,
      });

      await consumer.handleBudgetThresholdCrossed(event);

      const [callArgs] = fakes.notificationRepository.create.mock.calls[0]!;
      expect(callArgs.type).toBe('BudgetThresholdCrossed');
      expect(callArgs.dedupKey).toBe('budget-1:90:2026-08-01');
      expect(callArgs.message).toContain('FOOD_DINING');
      expect(callArgs.message).toMatch(/90%/);
    });

    it('renders a distinct message for the 100% threshold', async () => {
      const fakes = makeFakes();
      const consumer = makeConsumer(fakes);
      const event = makeEvent({
        eventType: 'BudgetThresholdCrossed',
        payload: { ...BUDGET_THRESHOLD_PAYLOAD, thresholdPercent: 100, utilizationPercent: 104 },
      });

      await consumer.handleBudgetThresholdCrossed(event);

      const [callArgs] = fakes.notificationRepository.create.mock.calls[0]!;
      expect(callArgs.message).toMatch(/gone over/i);
    });

    it('checks the BUDGET_ALERT preference, distinct from the debt-reminder preference', async () => {
      const fakes = makeFakes();
      fakes.preferenceRepository.isEnabled.mockResolvedValue(false);
      const consumer = makeConsumer(fakes);
      const event = makeEvent({
        eventType: 'BudgetThresholdCrossed',
        payload: BUDGET_THRESHOLD_PAYLOAD,
      });

      await consumer.handleBudgetThresholdCrossed(event);

      expect(fakes.preferenceRepository.isEnabled).toHaveBeenCalledWith(
        'user-1',
        'notif_budget_alert',
      );
      expect(fakes.notificationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'suppressed', suppressedReason: 'preference_disabled' }),
      );
    });

    it('rejects a malformed payload (fails safely, never silently no-ops)', async () => {
      const fakes = makeFakes();
      const consumer = makeConsumer(fakes);
      const event = makeEvent({
        eventType: 'BudgetThresholdCrossed',
        payload: { budgetId: 'budget-1' },
      });

      await expect(consumer.handleBudgetThresholdCrossed(event)).rejects.toThrow(/Malformed/);
      expect(fakes.notificationRepository.create).not.toHaveBeenCalled();
    });
  });
});

describe('dedup window selection (TASK-BOT-009-FIX)', () => {
  const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const ONE_HOUR_MS = 60 * 60 * 1000;

  it('BudgetThresholdCrossed (TASK-FIN-003) queries dedup with a 1-hour defensive-only window, keyed by the composite dedupKey', async () => {
    const fakes = makeFakes();
    const consumer = makeConsumer(fakes);
    const event = makeEvent({
      eventType: 'BudgetThresholdCrossed',
      payload: BUDGET_THRESHOLD_PAYLOAD,
    });

    await consumer.handleBudgetThresholdCrossed(event);

    expect(fakes.dedupRepository.wasRecentlyNotified).toHaveBeenCalledWith(
      'user-1',
      'BudgetThresholdCrossed',
      'budget-1:90:2026-08-01',
      expect.any(Date),
      ONE_HOUR_MS,
    );
  });

  it("DebtDueApproaching queries dedup with a 20-hour window (matching the producer's own APPROACHING_DEDUP_WINDOW_MS)", async () => {
    const fakes = makeFakes();
    const consumer = makeConsumer(fakes);
    const event = makeEvent({ eventType: 'DebtDueApproaching', payload: DEBT_REMINDER_PAYLOAD });

    await consumer.handleDebtDueApproaching(event);

    expect(fakes.dedupRepository.wasRecentlyNotified).toHaveBeenCalledWith(
      'user-1',
      'DebtDueApproaching',
      'debt-1',
      expect.any(Date),
      TWENTY_HOURS_MS,
    );
  });

  it("DebtOverdue queries dedup with a 7-day window (matching the producer's own OVERDUE_DEDUP_WINDOW_MS)", async () => {
    const fakes = makeFakes();
    const consumer = makeConsumer(fakes);
    const event = makeEvent({ eventType: 'DebtOverdue', payload: DEBT_REMINDER_PAYLOAD });

    await consumer.handleDebtOverdue(event);

    expect(fakes.dedupRepository.wasRecentlyNotified).toHaveBeenCalledWith(
      'user-1',
      'DebtOverdue',
      'debt-1',
      expect.any(Date),
      SEVEN_DAYS_MS,
    );
  });

  it('DebtSettled queries dedup with its own explicit 1-hour defensive-only window (no PRD cadence exists for it)', async () => {
    const fakes = makeFakes();
    const consumer = makeConsumer(fakes);
    const event = makeEvent({ eventType: 'DebtSettled', payload: DEBT_SETTLED_PAYLOAD });

    await consumer.handleDebtSettled(event);

    expect(fakes.dedupRepository.wasRecentlyNotified).toHaveBeenCalledWith(
      'user-1',
      'DebtSettled',
      'debt-1',
      expect.any(Date),
      ONE_HOUR_MS,
    );
  });

  it('an approaching notification suppresses (dedup) only when the repository itself reports a hit inside the 20h window it was asked about', async () => {
    const fakes = makeFakes();
    fakes.dedupRepository.wasRecentlyNotified.mockResolvedValue(true); // simulates a prior notification found within the 20h window queried
    const consumer = makeConsumer(fakes);
    const event = makeEvent({ eventType: 'DebtDueApproaching', payload: DEBT_REMINDER_PAYLOAD });

    await consumer.handleDebtDueApproaching(event);

    expect(fakes.dedupRepository.wasRecentlyNotified).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      TWENTY_HOURS_MS,
    );
    expect(fakes.notificationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suppressed', suppressedReason: 'dedup' }),
    );
    expect(fakes.deliveryQueue.enqueue).not.toHaveBeenCalled();
  });

  it('an approaching notification is delivered when the repository reports no hit within the 20h window it was asked about', async () => {
    const fakes = makeFakes();
    fakes.dedupRepository.wasRecentlyNotified.mockResolvedValue(false); // simulates no prior notification within the 20h window queried
    const consumer = makeConsumer(fakes);
    const event = makeEvent({ eventType: 'DebtDueApproaching', payload: DEBT_REMINDER_PAYLOAD });

    await consumer.handleDebtDueApproaching(event);

    expect(fakes.notificationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'debt-1', type: 'DebtDueApproaching' }),
    );
    expect(fakes.notificationRepository.create.mock.calls[0]![0]).not.toHaveProperty('status');
    expect(fakes.deliveryQueue.enqueue).toHaveBeenCalled();
  });

  it('an overdue notification suppresses (dedup) only when the repository reports a hit inside the 7-day window it was asked about', async () => {
    const fakes = makeFakes();
    fakes.dedupRepository.wasRecentlyNotified.mockResolvedValue(true); // simulates a prior notification found within the 7-day window queried
    const consumer = makeConsumer(fakes);
    const event = makeEvent({ eventType: 'DebtOverdue', payload: DEBT_REMINDER_PAYLOAD });

    await consumer.handleDebtOverdue(event);

    expect(fakes.dedupRepository.wasRecentlyNotified).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      SEVEN_DAYS_MS,
    );
    expect(fakes.notificationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suppressed', suppressedReason: 'dedup' }),
    );
    expect(fakes.deliveryQueue.enqueue).not.toHaveBeenCalled();
  });

  it('an overdue notification is delivered when the repository reports no hit within the 7-day window it was asked about', async () => {
    const fakes = makeFakes();
    fakes.dedupRepository.wasRecentlyNotified.mockResolvedValue(false); // simulates no prior notification within the 7-day window queried
    const consumer = makeConsumer(fakes);
    const event = makeEvent({ eventType: 'DebtOverdue', payload: DEBT_REMINDER_PAYLOAD });

    await consumer.handleDebtOverdue(event);

    expect(fakes.notificationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'debt-1', type: 'DebtOverdue' }),
    );
    expect(fakes.notificationRepository.create.mock.calls[0]![0]).not.toHaveProperty('status');
    expect(fakes.deliveryQueue.enqueue).toHaveBeenCalled();
  });

  it("cross-type dedup isolation: DebtDueApproaching and DebtOverdue for the same debtId each query with their own distinct window, never the other's", async () => {
    const fakes = makeFakes();
    const consumer = makeConsumer(fakes);
    const approachingEvent = makeEvent({
      eventType: 'DebtDueApproaching',
      payload: DEBT_REMINDER_PAYLOAD,
    });
    const overdueEvent = makeEvent({ eventType: 'DebtOverdue', payload: DEBT_REMINDER_PAYLOAD });

    await consumer.handleDebtDueApproaching(approachingEvent);
    await consumer.handleDebtOverdue(overdueEvent);

    const calls = fakes.dedupRepository.wasRecentlyNotified.mock.calls;
    expect(calls).toHaveLength(2);
    const [approachingCall, overdueCall] = calls as [unknown[], unknown[]];
    expect(approachingCall[1]).toBe('DebtDueApproaching');
    expect(approachingCall[4]).toBe(TWENTY_HOURS_MS);
    expect(overdueCall[1]).toBe('DebtOverdue');
    expect(overdueCall[4]).toBe(SEVEN_DAYS_MS);
    expect(approachingCall[4]).not.toBe(overdueCall[4]);
  });

  it('throws (never silently falls back to a default) for an event type with no defined preference/dedup policy', async () => {
    const fakes = makeFakes();
    const consumer = makeConsumer(fakes);

    // Fails at preferenceKeyFor (checked first, per FR-NOT-007's gate
    // order) rather than dedupWindowMsFor — either is an acceptable loud
    // failure; what matters is that an unrecognized event type never
    // silently proceeds with a default.
    await expect(
      (consumer as unknown as { gateAndDeliver: (...args: unknown[]) => Promise<void> })[
        'gateAndDeliver'
      ]('user-1', 'SomeUnknownEventType', 'debt-1', () => 'message'),
    ).rejects.toThrow(/No preference key defined|No dedup window policy/);
  });
});

describe('buildNotificationDeliveryConsumers', () => {
  it('registers exactly DebtDueApproaching, DebtOverdue, DebtSettled, and BudgetThresholdCrossed, each routed to the matching handler method', async () => {
    const fakes = makeFakes();
    const handler = makeConsumer(fakes);
    const spyApproaching = vi
      .spyOn(handler, 'handleDebtDueApproaching')
      .mockResolvedValue(undefined);
    const spyOverdue = vi.spyOn(handler, 'handleDebtOverdue').mockResolvedValue(undefined);
    const spySettled = vi.spyOn(handler, 'handleDebtSettled').mockResolvedValue(undefined);
    const spyBudget = vi
      .spyOn(handler, 'handleBudgetThresholdCrossed')
      .mockResolvedValue(undefined);

    const consumers = buildNotificationDeliveryConsumers(handler);
    expect(consumers.map((c) => c.eventType)).toEqual([
      'DebtDueApproaching',
      'DebtOverdue',
      'DebtSettled',
      'BudgetThresholdCrossed',
    ]);

    const event = makeEvent();
    await consumers[0]!.handle(event);
    await consumers[1]!.handle(event);
    await consumers[2]!.handle(event);
    await consumers[3]!.handle(event);

    expect(spyApproaching).toHaveBeenCalledWith(event);
    expect(spyOverdue).toHaveBeenCalledWith(event);
    expect(spySettled).toHaveBeenCalledWith(event);
    expect(spyBudget).toHaveBeenCalledWith(event);
  });
});
