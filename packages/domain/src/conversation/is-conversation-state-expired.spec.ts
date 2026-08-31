import { describe, expect, it } from 'vitest';

import { isConversationStateExpired } from './is-conversation-state-expired';
import type { ConversationStateRecord } from './conversation-state';

function record(overrides: Partial<ConversationStateRecord> = {}): ConversationStateRecord {
  return {
    userId: 'user-1',
    state: 'AWAITING_CLARIFICATION',
    contextPayload: {
      draftId: 'd',
      missingField: 'amount',
      retryCount: 0,
      lastQuestionAsked: null,
    },
    createdAt: '2026-08-14T10:00:00Z',
    expiresAt: '2026-08-14T10:30:00Z',
    version: 0,
    ...overrides,
  };
}

describe('isConversationStateExpired (§5.19.2 read-time enforcement)', () => {
  it('is not expired before the expiry timestamp', () => {
    expect(isConversationStateExpired(record(), '2026-08-14T10:29:59Z')).toBe(false);
  });

  it('is expired exactly at the expiry timestamp', () => {
    expect(isConversationStateExpired(record(), '2026-08-14T10:30:00Z')).toBe(true);
  });

  it('is expired well after the expiry timestamp', () => {
    expect(isConversationStateExpired(record(), '2026-08-14T12:00:00Z')).toBe(true);
  });

  it('IDLE records (expiresAt: null) are never expired', () => {
    expect(
      isConversationStateExpired(
        record({ state: 'IDLE', contextPayload: null, expiresAt: null }),
        '2099-01-01T00:00:00Z',
      ),
    ).toBe(false);
  });
});
