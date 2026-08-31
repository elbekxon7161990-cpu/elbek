import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_REPOSITORY,
  TELEGRAM_NOTIFICATION_SENDER,
  TelegramDeliveryBlockedError,
  USER_REPOSITORY,
  type NotificationRepository,
  type TelegramNotificationSender,
  type UserRepository,
} from '@afa/domain';
import type { NotificationDeliveryJobPayload } from '@afa/infrastructure';
import { NOTIFICATION_DELIVERY_QUEUE_NAME } from '@afa/infrastructure';
import { runWithUserContext } from '@afa/shared';
import type { Job } from 'bullmq';

/**
 * TASK-BOT-009 (§10.6.2's "Bot -> User" step) — the slow, network-bound
 * half of notification delivery. Deliberately lives here, in
 * `apps/telegram-bot` (Chapter 7 §7.2's own "Bot Application Layer" —
 * exactly what the PRD's own sequence diagram names as the actual sender),
 * rather than in `apps/worker`.
 *
 * This is a considered, disclosed exception to two existing, previously-
 * unbroken conventions, not an oversight: `apps/worker/src/app.module.ts`'s
 * own comment states "this app never imports telegraf," and
 * `apps/telegram-bot/src/app.module.ts`'s own comment states this app is
 * "a producer, never a consumer/processor" of BullMQ jobs. Both were true
 * of every feature built before this one. Putting real Telegram-sending
 * logic in `apps/worker` would have meant either violating the first
 * convention directly, or building a second cross-process hand-off just to
 * avoid it — worse than the alternative. Consuming exactly one new,
 * narrowly-scoped queue here is the smaller, more consistent deviation:
 * this app already owns the real Telegraf/Bot-API relationship end to end,
 * and the PRD's own architecture (§10.6.1's three-way production/
 * orchestration/delivery split) already names this app's role as the
 * delivery mechanism. See this task's final report for the full reasoning.
 *
 * `NotificationDeliveryConsumer` (`@afa/infrastructure`, runs inside
 * FR-DB-015's own claim transaction in `apps/worker`) never calls Telegram
 * itself — it only persists a `Notification` row and enqueues the job this
 * processor consumes, which is what keeps that consumer fast per its own
 * documented contract.
 */
@Processor(NOTIFICATION_DELIVERY_QUEUE_NAME)
@Injectable()
export class NotificationDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationDeliveryProcessor.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(TELEGRAM_NOTIFICATION_SENDER)
    private readonly telegramSender: TelegramNotificationSender,
  ) {
    super();
  }

  async process(job: Job<NotificationDeliveryJobPayload>): Promise<{ status: string }> {
    const { notificationId, userId } = job.data;

    const notification = await runWithUserContext(userId, () =>
      this.notificationRepository.findById(notificationId),
    );
    if (!notification) {
      throw new Error(`Notification "${notificationId}" not found — refusing to process.`);
    }
    if (notification.status === 'sent') {
      // Idempotency — a redelivered job for an already-sent notification is
      // a safe no-op, never a duplicate Telegram send (at-least-once
      // delivery, FR-FIN-048's own posture applied here).
      return { status: 'already_sent' };
    }
    if (notification.status === 'failed' || notification.status === 'suppressed') {
      // A `'suppressed'` row is never expected to reach this processor at
      // all (`NotificationDeliveryConsumer` never enqueues one) — this is
      // a defensive no-op, not a code path this task's own tests exercise
      // as a real scenario.
      return { status: `already_${notification.status}` };
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error(`User "${userId}" not found — cannot resolve a Telegram chat id.`);
    }

    try {
      await this.telegramSender.send(
        user.telegramUserId.toString(),
        notification.message,
        notification.replyMarkup ?? undefined,
      );
    } catch (error) {
      if (error instanceof TelegramDeliveryBlockedError) {
        // BR-NOT-001 — never retry a blocked recipient.
        await runWithUserContext(userId, () =>
          this.notificationRepository.markFailed(notificationId),
        );
        this.logger.warn(
          `Notification ${notificationId}: recipient has blocked the bot, marked failed.`,
        );
        return { status: 'blocked' };
      }
      throw error;
    }

    await runWithUserContext(userId, () =>
      this.notificationRepository.markSent(notificationId, new Date()),
    );
    return { status: 'sent' };
  }
}
