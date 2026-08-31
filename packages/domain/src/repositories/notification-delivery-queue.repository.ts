export const NOTIFICATION_DELIVERY_QUEUE = Symbol('NOTIFICATION_DELIVERY_QUEUE');

/**
 * TASK-BOT-009 — the hand-off from the fast, in-transaction
 * `NotificationDeliveryConsumer` (§10.6.2's "Worker → NotSvc" step) to the
 * separate, slow, network-bound Telegram send step (§10.6.2's "Bot ->
 * User" step). Two distinct steps, not one, because the *existing*
 * `DomainEventConsumer` contract (FR-DB-015, `domain-event-consumer.ts`'s
 * own doc comment) explicitly forbids a consumer making a slow outbound
 * network call while it holds the dispatcher's claim-transaction row lock
 * — this port is what lets the consumer stay fast (persist + enqueue only)
 * while the actual Telegram call happens later, outside that transaction,
 * in a real BullMQ job (`apps/worker`'s `NotificationDeliveryProcessor`).
 *
 * `deliverAt` in the future (quiet-hours queuing, FR-NOT-003) is
 * implemented via BullMQ's own native delayed-job support — no second
 * polling mechanism invented for this.
 */
export interface NotificationDeliveryQueue {
  enqueue(notificationId: string, userId: string, deliverAt: Date): Promise<void>;
}
