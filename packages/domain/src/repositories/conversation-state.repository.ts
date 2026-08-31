import type { ConversationStateRecord } from '../conversation/conversation-state';

export const CONVERSATION_STATE_REPOSITORY = Symbol('CONVERSATION_STATE_REPOSITORY');

/**
 * TASK-BOT-002 (Chapter 5 §5.12.1 "State Reader/Writer": "Reads and
 * atomically mutates `conversation_state:{user_id}` in Redis"; §5.16.2
 * BR-CE-006: "the State Reader/Writer must use an atomic compare-and-set
 * operation against Redis (not a naive read-then-write) so a lost update
 * is structurally impossible even under a genuine race").
 *
 * `compareAndSet` is the one write primitive this port exposes —
 * deliberately no plain `set`, so no caller can accidentally perform the
 * naive read-modify-write BR-CE-006 forbids. `expectedVersion` is the
 * `version` the caller last read (`0` / absent-record semantics are the
 * concrete adapter's concern, not this port's); the call succeeds only if
 * the stored version still matches, per the same optimistic-concurrency
 * shape TASK-DB-011's RLS work and this codebase's other ports already use.
 */
export interface ConversationStateRepository {
  get(userId: string): Promise<ConversationStateRecord | null>;
  /** Returns `true` if the write succeeded (version matched), `false` if a concurrent writer already changed the record (caller must re-read and retry, per BR-CE-006). */
  compareAndSet(
    userId: string,
    expectedVersion: number,
    newRecord: ConversationStateRecord,
  ): Promise<boolean>;
}
