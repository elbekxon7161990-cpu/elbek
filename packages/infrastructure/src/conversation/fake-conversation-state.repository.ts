import type { ConversationStateRecord, ConversationStateRepository } from '@afa/domain';

/**
 * A deterministic, in-memory `ConversationStateRepository` test double —
 * never wired into any production DI module (mirrors `FakeObjectStorage`'s
 * own role for TASK-AI-005). Implements the same compare-and-set contract
 * as `RedisConversationStateRepository`: a write only succeeds when the
 * caller's `expectedVersion` still matches what is stored (absent record =
 * version `0`), so tests exercising `ProcessConversationEventUseCase`'s CAS
 * retry loop behave identically against this fake and the real adapter.
 */
export class FakeConversationStateRepository implements ConversationStateRepository {
  private readonly records = new Map<string, ConversationStateRecord>();

  seed(record: ConversationStateRecord): void {
    this.records.set(record.userId, record);
  }

  async get(userId: string): Promise<ConversationStateRecord | null> {
    return this.records.get(userId) ?? null;
  }

  async compareAndSet(
    userId: string,
    expectedVersion: number,
    newRecord: ConversationStateRecord,
  ): Promise<boolean> {
    const current = this.records.get(userId);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== expectedVersion) {
      return false;
    }
    this.records.set(userId, newRecord);
    return true;
  }
}
