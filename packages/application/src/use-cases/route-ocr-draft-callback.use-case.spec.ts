import { describe, expect, it, vi } from 'vitest';
import type { DraftRepository, TransactionDraftRecord } from '@afa/domain';

import { ProcessConversationEventUseCase } from './process-conversation-event.use-case';
import {
  RouteOcrDraftCallbackUseCase,
  parseOcrDraftCallbackData,
} from './route-ocr-draft-callback.use-case';

function candidate() {
  return {
    intent: 'EXPENSE',
    amount: 45000,
    currency: 'UZS',
    category: 'FOOD_DINING',
    subcategory: null,
    merchant: 'Magazin No.7',
    paymentMethod: null,
    transactionDate: '2026-08-29',
    transactionTime: null,
    location: null,
    counterparty: null,
    dueDate: null,
    tags: [],
    description: 'Receipt purchase',
    confidenceScores: {},
  } as unknown as TransactionDraftRecord['partialData'];
}

function draftRecord(overrides: Partial<TransactionDraftRecord> = {}): TransactionDraftRecord {
  return {
    id: 'draft-1',
    userId: 'user-a',
    partialData: candidate(),
    missingFields: [],
    status: 'pending',
    originalText: 'ocr text',
    sourceType: 'photo',
    resolvedTransactionId: null,
    createdAt: new Date(),
    lastInteractionAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function fakeDraftRepository(record: TransactionDraftRecord | null): DraftRepository {
  return {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(record),
    findActiveByUserId: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(record),
  };
}

describe('parseOcrDraftCallbackData', () => {
  it('parses a well-formed ocrdraft_ callback', () => {
    expect(parseOcrDraftCallbackData('ocrdraft_confirm:draft-1')).toEqual({
      action: 'confirm',
      draftId: 'draft-1',
    });
  });

  it('rejects a non-ocrdraft_ prefix', () => {
    expect(parseOcrDraftCallbackData('confirm:draft-1')).toBeNull();
  });

  it('rejects a missing draft id', () => {
    expect(parseOcrDraftCallbackData('ocrdraft_confirm:')).toBeNull();
  });

  it('rejects an unknown action', () => {
    expect(parseOcrDraftCallbackData('ocrdraft_delete:draft-1')).toBeNull();
  });
});

describe('RouteOcrDraftCallbackUseCase', () => {
  it('returns malformed for unparseable callback data', async () => {
    const useCase = new RouteOcrDraftCallbackUseCase(
      fakeDraftRepository(null),
      {} as ProcessConversationEventUseCase,
    );
    const outcome = await useCase.execute({ userId: 'user-a', callbackData: 'garbage' });
    expect(outcome).toEqual({ kind: 'malformed' });
  });

  it('returns not_found when the draft does not exist', async () => {
    const useCase = new RouteOcrDraftCallbackUseCase(
      fakeDraftRepository(null),
      {} as ProcessConversationEventUseCase,
    );
    const outcome = await useCase.execute({
      userId: 'user-a',
      callbackData: 'ocrdraft_confirm:draft-1',
    });
    expect(outcome).toEqual({ kind: 'not_found' });
  });

  it('returns not_found (never a distinguishable error) when the draft belongs to a different user — cross-user isolation', async () => {
    const draftRepository = fakeDraftRepository(draftRecord({ userId: 'user-b' }));
    const useCase = new RouteOcrDraftCallbackUseCase(
      draftRepository,
      {} as ProcessConversationEventUseCase,
    );
    const outcome = await useCase.execute({
      userId: 'user-a',
      callbackData: 'ocrdraft_confirm:draft-1',
    });
    expect(outcome).toEqual({ kind: 'not_found' });
  });

  describe('cancel', () => {
    it('abandons a pending draft', async () => {
      const draftRepository = fakeDraftRepository(draftRecord());
      const useCase = new RouteOcrDraftCallbackUseCase(
        draftRepository,
        {} as ProcessConversationEventUseCase,
      );
      const outcome = await useCase.execute({
        userId: 'user-a',
        callbackData: 'ocrdraft_cancel:draft-1',
      });
      expect(outcome).toEqual({ kind: 'cancelled' });
      expect(draftRepository.updateStatus).toHaveBeenCalledWith('draft-1', { status: 'abandoned' });
    });

    it('is idempotent — cancelling an already-resolved draft never re-abandons it', async () => {
      const draftRepository = fakeDraftRepository(draftRecord({ status: 'completed' }));
      const useCase = new RouteOcrDraftCallbackUseCase(
        draftRepository,
        {} as ProcessConversationEventUseCase,
      );
      const outcome = await useCase.execute({
        userId: 'user-a',
        callbackData: 'ocrdraft_cancel:draft-1',
      });
      expect(outcome).toEqual({ kind: 'already_resolved' });
      expect(draftRepository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('commits via CANDIDATE_RESOLVED/auto_commit and reports the transaction id', async () => {
      const draftRepository = fakeDraftRepository(draftRecord());
      const processConversationEvent = {
        execute: vi.fn().mockResolvedValue({
          status: 'transitioned',
          requirementId: 'FR-CE-040',
          previousState: 'IDLE',
          nextState: 'IDLE',
          transactionId: 'txn-1',
          fallbackToMiniForm: false,
          flaggedFields: [],
        }),
      } as unknown as ProcessConversationEventUseCase;
      const useCase = new RouteOcrDraftCallbackUseCase(draftRepository, processConversationEvent);

      const outcome = await useCase.execute({
        userId: 'user-a',
        callbackData: 'ocrdraft_confirm:draft-1',
      });

      expect(outcome.kind).toBe('confirmed');
      expect((outcome as { transactionId: string }).transactionId).toBe('txn-1');
      expect(processConversationEvent.execute).toHaveBeenCalledWith(
        'user-a',
        expect.objectContaining({ type: 'CANDIDATE_RESOLVED', classification: 'auto_commit' }),
      );
    });

    it('surfaces commit_failed without throwing', async () => {
      const draftRepository = fakeDraftRepository(draftRecord());
      const processConversationEvent = {
        execute: vi.fn().mockResolvedValue({ status: 'commit_failed', reason: 'invalid category' }),
      } as unknown as ProcessConversationEventUseCase;
      const useCase = new RouteOcrDraftCallbackUseCase(draftRepository, processConversationEvent);

      const outcome = await useCase.execute({
        userId: 'user-a',
        callbackData: 'ocrdraft_confirm:draft-1',
      });
      expect(outcome).toEqual({ kind: 'commit_failed', reason: 'invalid category' });
    });

    it('surfaces retry when the guard table rejects (user was mid an unrelated concurrent flow)', async () => {
      const draftRepository = fakeDraftRepository(draftRecord());
      const processConversationEvent = {
        execute: vi.fn().mockResolvedValue({ status: 'rejected', requirementId: null, reason: 'x' }),
      } as unknown as ProcessConversationEventUseCase;
      const useCase = new RouteOcrDraftCallbackUseCase(draftRepository, processConversationEvent);

      const outcome = await useCase.execute({
        userId: 'user-a',
        callbackData: 'ocrdraft_confirm:draft-1',
      });
      expect(outcome).toEqual({ kind: 'retry' });
    });
  });

  describe('edit', () => {
    it('commits via CANDIDATE_RESOLVED/flagged_review and returns the real, guard-table-derived flagged fields', async () => {
      const draftRepository = fakeDraftRepository(draftRecord());
      const processConversationEvent = {
        execute: vi.fn().mockResolvedValue({
          status: 'transitioned',
          requirementId: 'FR-CE-044',
          previousState: 'IDLE',
          nextState: 'AWAITING_CONFIRMATION',
          transactionId: 'txn-2',
          fallbackToMiniForm: false,
          flaggedFields: ['amount', 'merchant'],
        }),
      } as unknown as ProcessConversationEventUseCase;
      const useCase = new RouteOcrDraftCallbackUseCase(draftRepository, processConversationEvent);

      const outcome = await useCase.execute({
        userId: 'user-a',
        callbackData: 'ocrdraft_edit:draft-1',
      });

      expect(outcome).toEqual(
        expect.objectContaining({
          kind: 'edit_ready',
          transactionId: 'txn-2',
          flaggedFields: ['amount', 'merchant'],
        }),
      );
      expect(processConversationEvent.execute).toHaveBeenCalledWith(
        'user-a',
        expect.objectContaining({ type: 'CANDIDATE_RESOLVED', classification: 'flagged_review' }),
      );
    });
  });
});
