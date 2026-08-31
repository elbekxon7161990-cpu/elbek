import type {
  NotificationRecord,
  NotificationStatus,
  SuppressedReason,
  TelegramInlineKeyboard,
} from '@afa/domain';
import type { Notification as PrismaNotificationRow } from '@prisma/client';

interface NotificationPayloadShape {
  message: string;
  dedupKey: string;
  readyToDeliverAt: string;
  suppressedReason?: SuppressedReason;
  /** TASK-AI-006 — additive; absent on every notification created before this field existed. */
  replyMarkup?: TelegramInlineKeyboard;
}

/** `payload`'s shape is this task's own convention (§13.9's `payload` column has no fixed structure) — see `notification.repository.ts`'s own doc comment. */
export function toDomainNotificationRecord(row: PrismaNotificationRow): NotificationRecord {
  const payload = row.payload as unknown as NotificationPayloadShape;
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    message: payload.message,
    dedupKey: payload.dedupKey,
    readyToDeliverAt: new Date(payload.readyToDeliverAt),
    status: row.status as NotificationStatus,
    suppressedReason: payload.suppressedReason ?? null,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    replyMarkup: payload.replyMarkup ?? null,
  };
}

export function toNotificationPayloadJson(
  message: string,
  dedupKey: string,
  readyToDeliverAt: Date,
  suppressedReason?: SuppressedReason,
  replyMarkup?: TelegramInlineKeyboard,
): NotificationPayloadShape {
  return {
    message,
    dedupKey,
    readyToDeliverAt: readyToDeliverAt.toISOString(),
    ...(suppressedReason ? { suppressedReason } : {}),
    ...(replyMarkup ? { replyMarkup } : {}),
  };
}
