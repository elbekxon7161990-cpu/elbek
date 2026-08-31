import type { ConversationStateRecord } from './conversation-state';

/**
 * §5.19.2 — "The Transition Evaluator treats *any* state read as expired
 * if its `expires_at` has passed, independent of whether a background
 * expiry job actually ran — expiry is enforced at read time, not solely
 * by a sweep job, so a failed sweep does not cause incorrect behavior,
 * only a delay in Redis memory reclamation."
 *
 * `IDLE` records have `expiresAt: null` and are never expired by this
 * check (nothing to expire — IDLE has no TTL, per §5.2.2).
 */
export function isConversationStateExpired(record: ConversationStateRecord, now: string): boolean {
  if (record.expiresAt === null) {
    return false;
  }
  return new Date(record.expiresAt).getTime() <= new Date(now).getTime();
}
