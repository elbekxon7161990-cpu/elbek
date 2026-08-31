export const COMMIT_IDEMPOTENCY_LOCK = Symbol('COMMIT_IDEMPOTENCY_LOCK');

/**
 * TASK-FIN-REAL-001 — "the same logical commit must produce exactly one
 * transaction," even under a genuine race (a Telegram retry slipping past
 * TASK-BOT-001's own `update_id` dedup, or two near-simultaneous calls
 * reaching `TransactionCommitPort.commit` for the same draft). Mirrors the
 * exact atomic-claim pattern already established twice in this codebase
 * (`TelegramUpdateDedupService`'s `SET NX`, `ConversationStateRepository`'s
 * compare-and-set) rather than inventing a new mechanism or a database
 * schema change — deliberately NOT a `transactions` table unique
 * constraint, since that table is natively partitioned by
 * `transaction_date` (schema.prisma's own header comment) and a
 * cross-partition uniqueness guarantee would need a real migration this
 * task's own scope doesn't require.
 */
export interface CommitIdempotencyLockPort {
  /** Atomically claims `key` if unclaimed. Returns `true` if this caller now owns it, `false` if another caller already does (win-once-per-key). */
  tryClaim(key: string, ttlSeconds: number): Promise<boolean>;
  /** The previously-stored result for `key` (e.g. a `transactionId`), or `null` if none has been stored yet — used by a losing claimant to hand back the winner's result instead of erroring. */
  getResult(key: string): Promise<string | null>;
  /** Stores the final result for `key`, extending its TTL so a later duplicate call reads it directly rather than reclaiming. */
  storeResult(key: string, result: string, ttlSeconds: number): Promise<void>;
  /** Releases a claim without storing a result (a failed commit) so a legitimate retry is not permanently blocked by its own prior failure. */
  release(key: string): Promise<void>;
}
