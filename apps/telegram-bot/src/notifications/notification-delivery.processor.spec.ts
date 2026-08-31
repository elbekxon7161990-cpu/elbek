import { TelegramDeliveryBlockedError } from '@afa/domain';
import type {
  NotificationRecord,
  NotificationRepository,
  TelegramNotificationSender,
  User,
  UserRepository,
} from '@afa/domain';
import type { NotificationDeliveryJobPayload } from '@afa/infrastructure';
import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

import { NotificationDeliveryProcessor } from './notification-delivery.processor';

function makeNotification(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'notification-1',
    userId: 'user-1',
    type: 'DebtDueApproaching',
    message: 'Reminder: your debt with Aziz is due 2026-09-01.',
    dedupKey: 'debt-1',
    readyToDeliverAt: new Date('2026-08-15T00:00:00Z'),
    status: 'queued',
    suppressedReason: null,
    sentAt: null,
    createdAt: new Date('2026-08-14T00:00:00Z'),
    replyMarkup: null,
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', telegramUserId: 123456789n, ...overrides } as User;
}

function makeJob(data: NotificationDeliveryJobPayload): Job<NotificationDeliveryJobPayload> {
  return { data } as Job<NotificationDeliveryJobPayload>;
}

describe('NotificationDeliveryProcessor', () => {
  it('sends the real message to the correct Telegram chat id and marks the notification sent', async () => {
    const notificationRepository = {
      findById: vi.fn().mockResolvedValue(makeNotification()),
      markSent: vi.fn().mockResolvedValue(makeNotification({ status: 'sent' })),
    } as unknown as NotificationRepository;
    const userRepository = {
      findById: vi.fn().mockResolvedValue(makeUser()),
    } as unknown as UserRepository;
    const telegramSender = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as TelegramNotificationSender;

    const processor = new NotificationDeliveryProcessor(
      notificationRepository,
      userRepository,
      telegramSender,
    );

    const result = await processor.process(
      makeJob({ notificationId: 'notification-1', userId: 'user-1' }),
    );

    expect(telegramSender.send).toHaveBeenCalledWith(
      '123456789',
      'Reminder: your debt with Aziz is due 2026-09-01.',
      undefined,
    );
    expect(notificationRepository.markSent).toHaveBeenCalledWith(
      'notification-1',
      expect.any(Date),
    );
    expect(result).toEqual({ status: 'sent' });
  });

  it('TASK-AI-006 — passes a notification\'s replyMarkup through to the sender when present (e.g. an OCR draft review card)', async () => {
    const keyboard = [[{ text: '✅ Confirm', callback_data: 'ocrdraft_confirm:draft-1' }]];
    const notificationRepository = {
      findById: vi.fn().mockResolvedValue(makeNotification({ replyMarkup: keyboard })),
      markSent: vi.fn().mockResolvedValue(makeNotification({ status: 'sent' })),
    } as unknown as NotificationRepository;
    const userRepository = {
      findById: vi.fn().mockResolvedValue(makeUser()),
    } as unknown as UserRepository;
    const telegramSender = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as TelegramNotificationSender;

    const processor = new NotificationDeliveryProcessor(
      notificationRepository,
      userRepository,
      telegramSender,
    );
    await processor.process(
      makeJob({ notificationId: 'notification-1', userId: 'user-1' }),
    );

    expect(telegramSender.send).toHaveBeenCalledWith(
      '123456789',
      'Reminder: your debt with Aziz is due 2026-09-01.',
      keyboard,
    );
  });

  it('never re-sends an already-sent notification (idempotent redelivery, FR-FIN-048)', async () => {
    const notificationRepository = {
      findById: vi.fn().mockResolvedValue(makeNotification({ status: 'sent' })),
      markSent: vi.fn(),
    } as unknown as NotificationRepository;
    const userRepository = { findById: vi.fn() } as unknown as UserRepository;
    const telegramSender = { send: vi.fn() } as unknown as TelegramNotificationSender;

    const processor = new NotificationDeliveryProcessor(
      notificationRepository,
      userRepository,
      telegramSender,
    );

    const result = await processor.process(
      makeJob({ notificationId: 'notification-1', userId: 'user-1' }),
    );

    expect(telegramSender.send).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'already_sent' });
  });

  it('marks the notification "failed" (never retried) on a bot-blocked recipient (BR-NOT-001)', async () => {
    const notificationRepository = {
      findById: vi.fn().mockResolvedValue(makeNotification()),
      markFailed: vi.fn().mockResolvedValue(makeNotification({ status: 'failed' })),
    } as unknown as NotificationRepository;
    const userRepository = {
      findById: vi.fn().mockResolvedValue(makeUser()),
    } as unknown as UserRepository;
    const telegramSender = {
      send: vi.fn().mockRejectedValue(new TelegramDeliveryBlockedError('123456789')),
    } as unknown as TelegramNotificationSender;

    const processor = new NotificationDeliveryProcessor(
      notificationRepository,
      userRepository,
      telegramSender,
    );

    const result = await processor.process(
      makeJob({ notificationId: 'notification-1', userId: 'user-1' }),
    );

    expect(notificationRepository.markFailed).toHaveBeenCalledWith('notification-1');
    expect(result).toEqual({ status: 'blocked' });
  });

  it('propagates a transient send error so BullMQ applies its own retry/backoff', async () => {
    const notificationRepository = {
      findById: vi.fn().mockResolvedValue(makeNotification()),
    } as unknown as NotificationRepository;
    const userRepository = {
      findById: vi.fn().mockResolvedValue(makeUser()),
    } as unknown as UserRepository;
    const telegramSender = {
      send: vi.fn().mockRejectedValue(new Error('network timeout')),
    } as unknown as TelegramNotificationSender;

    const processor = new NotificationDeliveryProcessor(
      notificationRepository,
      userRepository,
      telegramSender,
    );

    await expect(
      processor.process(makeJob({ notificationId: 'notification-1', userId: 'user-1' })),
    ).rejects.toThrow('network timeout');
  });

  it('throws when the notification no longer exists (a malformed/stale job)', async () => {
    const notificationRepository = {
      findById: vi.fn().mockResolvedValue(null),
    } as unknown as NotificationRepository;
    const userRepository = { findById: vi.fn() } as unknown as UserRepository;
    const telegramSender = { send: vi.fn() } as unknown as TelegramNotificationSender;

    const processor = new NotificationDeliveryProcessor(
      notificationRepository,
      userRepository,
      telegramSender,
    );

    await expect(
      processor.process(makeJob({ notificationId: 'missing', userId: 'user-1' })),
    ).rejects.toThrow(/not found/i);
  });
});
