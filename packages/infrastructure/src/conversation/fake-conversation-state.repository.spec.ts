import { describe, expect, it } from 'vitest';
import type { ConversationStateRecord } from '@afa/domain';

import { FakeConversationStateRepository } from './fake-conversation-state.repository';

function record(overrides: Partial<ConversationStateRecord> = {}): ConversationStateRecord {
  return {
    userId: 'user-1',
    state: 'IDLE',
    contextPayload: null,
    createdAt: '2026-08-14T10:00:00.000Z',
    expiresAt: null,
    version: 0,
    ...overrides,
  };
}

describe('FakeConversationStateRepository', () => {
  it('returns null for a user with no seeded/written state', async () => {
    const repo = new FakeConversationStateRepository();

    await expect(repo.get('user-1')).resolves.toBeNull();
  });

  it('returns a previously seeded record', async () => {
    const repo = new FakeConversationStateRepository();
    repo.seed(record({ state: 'AWAITING_CLARIFICATION' }));

    await expect(repo.get('user-1')).resolves.toMatchObject({ state: 'AWAITING_CLARIFICATION' });
  });

  it('succeeds a compare-and-set against an absent record only at expectedVersion 0', async () => {
    const repo = new FakeConversationStateRepository();

    const written = await repo.compareAndSet('user-1', 0, record({ version: 1 }));

    expect(written).toBe(true);
    await expect(repo.get('user-1')).resolves.toMatchObject({ version: 1 });
  });

  it('rejects a compare-and-set whose expectedVersion does not match', async () => {
    const repo = new FakeConversationStateRepository();
    repo.seed(record({ version: 1 }));

    const written = await repo.compareAndSet('user-1', 0, record({ version: 2 }));

    expect(written).toBe(false);
    await expect(repo.get('user-1')).resolves.toMatchObject({ version: 1 }); // unchanged
  });

  it('isolates state between different users', async () => {
    const repo = new FakeConversationStateRepository();
    repo.seed(record({ userId: 'user-a', state: 'AWAITING_CLARIFICATION' }));
    repo.seed(record({ userId: 'user-b', state: 'IDLE' }));

    await expect(repo.get('user-a')).resolves.toMatchObject({ state: 'AWAITING_CLARIFICATION' });
    await expect(repo.get('user-b')).resolves.toMatchObject({ state: 'IDLE' });
  });
});
