import type { TelegramInlineKeyboard } from '../notifications/telegram-inline-keyboard';

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

/**
 * The table's own real CHECK constraint (§13.9's `notifications.status`,
 * confirmed against `migration.sql`, not assumed): `'queued'` (created,
 * not yet delivered — includes a quiet-hours-delayed one),
 * `'sent'`, `'failed'`, `'suppressed'` — the schema itself already
 * anticipated recording a gate-suppressed notification (preference-
 * disabled or deduped) as its own row, not merely skipping it silently,
 * which directly matches §10.6.4's own worked example: "Every step is
 * auditable independently — a support agent investigating 'why didn't I
 * get warned' can check each gate in this sequence rather than treating
 * delivery as an opaque black box."
 */
export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'suppressed';

export type SuppressedReason = 'preference_disabled' | 'dedup';

/**
 * TASK-BOT-009 — the persisted, per-notification-attempt record (§13.9
 * `notifications`). `message`/`dedupKey`/`readyToDeliverAt`/`suppressedReason`
 * live inside the existing `payload` JSONB column (no schema migration —
 * this table has no dedicated columns for any of them, and `payload` is
 * already general-purpose storage).
 */
export interface NewNotificationData {
  userId: string;
  /** The originating `DomainEventType` string (e.g. `'DebtDueApproaching'`) — kept as the real, already-stable catalogue vocabulary rather than inventing a second, parallel "notification type" enum. */
  type: string;
  /**
   * The rendered message text. FR-NOT-007 — "a suppressed notification
   * must never incur the cost of being formatted/rendered first" — so a
   * `status: 'suppressed'` row's `message` must always be `''`, never a
   * real rendered value; callers must not render before knowing whether a
   * gate will suppress.
   */
  message: string;
  /** FR-NOT-009's cadence-dedup key (e.g. the debt id) — scoped within `(userId, type)`, not globally unique on its own. */
  dedupKey: string;
  /** `now` for immediate delivery, or the computed quiet-hours window end for a queued one (FR-NOT-003/§10.6.6). Meaningless for a `'suppressed'` row — still required for a consistent shape; callers pass `now`. */
  readyToDeliverAt: Date;
  /** Defaults to `'queued'` — the only two statuses a *new* row can start as; `'sent'`/`'failed'` are reached only via `markSent`/`markFailed`. */
  status?: 'queued' | 'suppressed';
  /** Required when `status: 'suppressed'`, omitted otherwise. */
  suppressedReason?: SuppressedReason;
  /**
   * TASK-AI-006 — an optional inline keyboard to attach to this
   * notification's Telegram message (e.g. an OCR draft's Confirm/Edit/
   * Cancel review card). Additive: every existing caller (debt reminders,
   * budget alerts) omits this and is completely unaffected — stored in the
   * same general-purpose `payload` JSONB column `message`/`dedupKey`
   * already use, no schema migration needed.
   */
  replyMarkup?: TelegramInlineKeyboard;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  message: string;
  dedupKey: string;
  readyToDeliverAt: Date;
  status: NotificationStatus;
  suppressedReason: SuppressedReason | null;
  sentAt: Date | null;
  createdAt: Date;
  /** See `NewNotificationData.replyMarkup`'s doc comment. `null` for every notification created before this field existed, and for every type that never sets it. */
  replyMarkup: TelegramInlineKeyboard | null;
}

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary) for `notifications` (§13.9).
 * Deliberately does NOT expose a "find all pending, across every user"
 * method — `Notification` is genuinely RLS-protected (unlike `DomainEvent`,
 * a system-wide dispatch queue with no such policy), so a cross-user scan
 * would either bypass a real Postgres row-level-security policy (a security
 * regression) or silently return nothing under RLS enforcement (a
 * correctness bug) — see this task's final report for the full reasoning.
 * The delivery hand-off instead goes through a real per-notification BullMQ
 * job (`NotificationDeliveryQueue`, carrying a known `userId`), so every
 * later read of this repository is always correctly scoped to one already-
 * known user via `runWithUserContext`, never a blind system-wide query.
 */
export interface NotificationRepository {
  create(data: NewNotificationData): Promise<NotificationRecord>;
  findById(id: string): Promise<NotificationRecord | null>;
  /** Idempotent no-op if already `'sent'` (BullMQ at-least-once redelivery safety, FR-FIN-048's own posture applied here) — implementations must not error on a repeat call, only skip re-sending upstream. */
  markSent(id: string, now: Date): Promise<NotificationRecord | null>;
  markFailed(id: string): Promise<NotificationRecord | null>;
}
