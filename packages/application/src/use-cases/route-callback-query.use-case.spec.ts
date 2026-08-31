import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AwaitingMultiItemReviewContext,
  ConversationStateRecord,
  ConversationStateRepository,
  DraftRepository,
  DraftStatusPatch,
  NewTransactionDraftData,
  TransactionCommitPort,
  TransactionCommitRequest,
  TransactionCommitResult,
  TransactionDraftRecord,
  TransactionExtractionCandidate,
} from '@afa/domain';

import type { DeleteTransactionInput } from '../dto/delete-transaction.input';
import { ProcessConversationEventUseCase } from './process-conversation-event.use-case';
import { RouteCallbackQueryUseCase, parseCallbackData } from './route-callback-query.use-case';
import type { DeleteTransactionUseCase } from './delete-transaction.use-case';

class LocalFakeDraftRepository implements DraftRepository {
  readonly records = new Map<string, TransactionDraftRecord>();

  seed(record: TransactionDraftRecord): void {
    this.records.set(record.id, record);
  }

  async create(data: NewTransactionDraftData): Promise<TransactionDraftRecord> {
    const record: TransactionDraftRecord = {
      id: data.id,
      userId: data.userId,
      partialData: data.partialData,
      missingFields: data.missingFields,
      status: 'pending',
      originalText: data.originalText,
      sourceType: data.sourceType,
      resolvedTransactionId: null,
      createdAt: new Date(),
      lastInteractionAt: new Date(),
      deletedAt: null,
    };
    this.records.set(data.id, record);
    return record;
  }

  async findById(id: string): Promise<TransactionDraftRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findActiveByUserId(userId: string): Promise<TransactionDraftRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.userId === userId && record.status === 'pending',
    );
  }

  async updateStatus(id: string, patch: DraftStatusPatch): Promise<TransactionDraftRecord> {
    // Tests not specifically about draft lifecycle (e.g. plain cancel/edit
    // routing) don't seed a draft first — auto-vivify a minimal stub rather
    // than throwing, matching the same convention as
    // process-conversation-event.use-case.spec.ts's own fake. The dedicated
    // 'undo' tests below seed a real draft first.
    const existing = this.records.get(id) ?? {
      id,
      userId: 'unknown',
      partialData: {} as never,
      missingFields: [],
      status: 'pending' as const,
      originalText: '',
      sourceType: 'text' as const,
      resolvedTransactionId: null,
      createdAt: new Date(),
      lastInteractionAt: new Date(),
      deletedAt: null,
    };
    const updated: TransactionDraftRecord = {
      ...existing,
      status: patch.status,
      resolvedTransactionId: patch.resolvedTransactionId ?? existing.resolvedTransactionId,
      lastInteractionAt: new Date(),
    };
    this.records.set(id, updated);
    return updated;
  }
}

class LocalFakeDeleteTransactionUseCase {
  readonly calls: DeleteTransactionInput[] = [];
  async execute(input: DeleteTransactionInput): Promise<void> {
    this.calls.push(input);
  }
}

class LocalFakeConversationStateRepository implements ConversationStateRepository {
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
    if ((current?.version ?? 0) !== expectedVersion) return false;
    this.records.set(userId, newRecord);
    return true;
  }
}

class LocalFakeTransactionCommitPort implements TransactionCommitPort {
  readonly calls: TransactionCommitRequest[] = [];
  /** Keyed by draftId — lets a test simulate one specific commit failing without affecting the rest. */
  readonly failFor = new Set<string>();
  private counter = 0;

  async commit(request: TransactionCommitRequest): Promise<TransactionCommitResult> {
    this.calls.push(request);
    if (this.failFor.has(request.draftId)) {
      throw new Error(`Simulated commit failure for ${request.draftId}`);
    }
    this.counter += 1;
    return { transactionId: `txn-batch-${this.counter}` };
  }
}

const USER_ID = 'user-1';
const NOW = '2026-08-14T10:00:00+05:00';

function buildUseCase() {
  const stateRepository = new LocalFakeConversationStateRepository();
  const draftRepository = new LocalFakeDraftRepository();
  const commitPort = new LocalFakeTransactionCommitPort();
  const deleteTransaction = new LocalFakeDeleteTransactionUseCase();
  const processEvent = new ProcessConversationEventUseCase(
    stateRepository,
    commitPort,
    draftRepository,
    deleteTransaction as unknown as DeleteTransactionUseCase,
  );
  const useCase = new RouteCallbackQueryUseCase(
    stateRepository,
    draftRepository,
    commitPort,
    processEvent,
  );
  return { useCase, stateRepository, draftRepository, commitPort, deleteTransaction };
}

describe('parseCallbackData', () => {
  it('parses a confirm action', () => {
    expect(parseCallbackData('confirm:txn-1')).toEqual({
      action: 'confirm',
      transactionId: 'txn-1',
      targetField: null,
    });
  });

  it('parses an edit action with a target field', () => {
    expect(parseCallbackData('edit:txn-1:amount')).toEqual({
      action: 'edit',
      transactionId: 'txn-1',
      targetField: 'amount',
    });
  });

  it('parses a cancel action', () => {
    expect(parseCallbackData('cancel:txn-1')).toEqual({
      action: 'cancel',
      transactionId: 'txn-1',
      targetField: null,
    });
  });

  it('parses an undo action', () => {
    expect(parseCallbackData('undo:txn-1')).toEqual({
      action: 'undo',
      transactionId: 'txn-1',
      targetField: null,
    });
  });

  it('rejects an unrecognized action', () => {
    expect(parseCallbackData('delete:txn-1')).toBeNull();
  });

  it('rejects edit without a target field', () => {
    expect(parseCallbackData('edit:txn-1')).toBeNull();
  });

  it('rejects a string with no transactionId', () => {
    expect(parseCallbackData('confirm')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parseCallbackData('')).toBeNull();
  });
});

describe('RouteCallbackQueryUseCase', () => {
  // TASK-BOT-007-REGRESSION-FIX — `ProcessConversationEventUseCase.execute()`
  // (called internally by 'undo'/'batch_confirm'/'batch_skip'/'cancel')
  // reads the REAL system clock (`new Date().toISOString()`) for its own
  // expiry check, independent of the `currentDateTime` this file's fixtures
  // pass to `RouteCallbackQueryUseCase.execute()` itself. Every fixture
  // below seeds a fixed, hardcoded `expiresAt` (e.g. '2026-08-15T...') that
  // was originally "safely in the future" but is not pinned against real
  // time — once real elapsed time passed that fixed date, every test whose
  // assertions depend on `ProcessConversationEventUseCase`'s internal check
  // started failing, without any change to production code. Pinning the
  // system clock here (matching `process-conversation-event.use-case.spec.ts`'s
  // own established `vi.useFakeTimers()`/`vi.setSystemTime(new Date(NOW))`
  // pattern exactly) makes every fixture's date fixed relative to a
  // controlled clock instead of an uncontrolled one — this file's own
  // `NOW` constant is deliberately reused as the pinned instant, so no
  // fixture value needs to change.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns malformed for unparseable callback data', async () => {
    const { useCase } = buildUseCase();

    const outcome = await useCase.execute({
      userId: USER_ID,
      callbackData: 'nonsense',
      currentDateTime: NOW,
    });

    expect(outcome).toEqual({ kind: 'malformed' });
  });

  it('cancels from any pending state without requiring the transactionId to match', async () => {
    const { useCase, stateRepository } = buildUseCase();
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_CLARIFICATION',
      contextPayload: {
        draftId: 'd',
        missingField: 'amount',
        retryCount: 0,
        lastQuestionAsked: null,
      },
      createdAt: NOW,
      expiresAt: '2026-08-14T10:30:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute({
      userId: USER_ID,
      callbackData: 'cancel:whatever',
      currentDateTime: NOW,
    });

    expect(outcome.kind).toBe('cancelled');
  });

  it('acknowledges a confirm action against the matching AWAITING_CONFIRMATION context, with no state write', async () => {
    const { useCase, stateRepository } = buildUseCase();
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_CONFIRMATION',
      contextPayload: { transactionId: 'txn-1', draftId: 'draft-1', flaggedFields: ['amount'] },
      createdAt: NOW,
      expiresAt: '2026-08-15T10:00:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute({
      userId: USER_ID,
      callbackData: 'confirm:txn-1',
      currentDateTime: NOW,
    });

    expect(outcome).toEqual({ kind: 'acknowledged' });
    const stored = await stateRepository.get(USER_ID);
    expect(stored?.version).toBe(1); // unchanged
  });

  it('requests an edit against the matching AWAITING_CONFIRMATION context', async () => {
    const { useCase, stateRepository } = buildUseCase();
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_CONFIRMATION',
      contextPayload: { transactionId: 'txn-1', draftId: 'draft-1', flaggedFields: ['amount'] },
      createdAt: NOW,
      expiresAt: '2026-08-15T10:00:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute({
      userId: USER_ID,
      callbackData: 'edit:txn-1:amount',
      currentDateTime: NOW,
    });

    expect(outcome.kind).toBe('edit_requested');
    if (
      outcome.kind === 'edit_requested' &&
      outcome.processEventOutcome.status === 'transitioned'
    ) {
      expect(outcome.processEventOutcome.nextState).toBe('AWAITING_EDIT_VALUE');
    }
  });

  it('reports stale when the callback transactionId does not match the currently stored one (§7.2.6)', async () => {
    const { useCase, stateRepository } = buildUseCase();
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_CONFIRMATION',
      contextPayload: { transactionId: 'txn-1', draftId: 'draft-1', flaggedFields: [] },
      createdAt: NOW,
      expiresAt: '2026-08-15T10:00:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute({
      userId: USER_ID,
      callbackData: 'edit:txn-DIFFERENT:amount',
      currentDateTime: NOW,
    });

    expect(outcome).toEqual({ kind: 'stale' });
  });

  it('reports stale when there is no pending confirmation at all (fresh/IDLE user)', async () => {
    const { useCase } = buildUseCase();

    const outcome = await useCase.execute({
      userId: USER_ID,
      callbackData: 'edit:txn-1:amount',
      currentDateTime: NOW,
    });

    expect(outcome).toEqual({ kind: 'stale' });
  });

  it('reports stale for an expired AWAITING_CONFIRMATION context (§5.19.2 read-time enforcement)', async () => {
    const { useCase, stateRepository } = buildUseCase();
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_CONFIRMATION',
      contextPayload: { transactionId: 'txn-1', draftId: 'draft-1', flaggedFields: [] },
      createdAt: '2026-08-13T10:00:00+05:00',
      expiresAt: '2026-08-13T10:30:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute({
      userId: USER_ID,
      callbackData: 'confirm:txn-1',
      currentDateTime: NOW,
    });

    expect(outcome).toEqual({ kind: 'stale' });
  });

  it('a double-tap replay of the same edit callback is a no-op the second time (BR-BOT-001)', async () => {
    const { useCase, stateRepository } = buildUseCase();
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_CONFIRMATION',
      contextPayload: { transactionId: 'txn-1', draftId: 'draft-1', flaggedFields: [] },
      createdAt: NOW,
      expiresAt: '2026-08-15T10:00:00+05:00',
      version: 1,
    });

    const first = await useCase.execute({
      userId: USER_ID,
      callbackData: 'edit:txn-1:amount',
      currentDateTime: NOW,
    });
    const replay = await useCase.execute({
      userId: USER_ID,
      callbackData: 'edit:txn-1:amount',
      currentDateTime: NOW,
    });

    expect(first.kind).toBe('edit_requested');
    expect(replay).toEqual({ kind: 'stale' }); // current state is now AWAITING_EDIT_VALUE, not AWAITING_CONFIRMATION
  });

  describe('undo (FR-CE-013)', () => {
    function seedConfirmation(stateRepository: LocalFakeConversationStateRepository): void {
      stateRepository.seed({
        userId: USER_ID,
        state: 'AWAITING_CONFIRMATION',
        contextPayload: { transactionId: 'txn-1', draftId: 'draft-1', flaggedFields: ['amount'] },
        createdAt: NOW,
        expiresAt: '2026-08-15T10:00:00+05:00',
        version: 1,
      });
    }

    it('reverses the transaction and marks the draft abandoned, ownership-checked against the matching context', async () => {
      const { useCase, stateRepository, draftRepository, deleteTransaction } = buildUseCase();
      seedConfirmation(stateRepository);
      draftRepository.seed({
        id: 'draft-1',
        userId: USER_ID,
        partialData: {} as never,
        missingFields: [],
        status: 'completed',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
        resolvedTransactionId: 'txn-1',
        createdAt: new Date(),
        lastInteractionAt: new Date(),
        deletedAt: null,
      });

      const outcome = await useCase.execute({
        userId: USER_ID,
        callbackData: 'undo:txn-1',
        currentDateTime: NOW,
      });

      expect(outcome.kind).toBe('undone');
      expect(deleteTransaction.calls).toEqual([
        { transactionId: 'txn-1', userId: USER_ID, actor: 'undo' },
      ]);
      expect(draftRepository.records.get('draft-1')?.status).toBe('abandoned');
      const stored = await stateRepository.get(USER_ID);
      expect(stored?.state).toBe('IDLE');
    });

    it('reports stale for an undo whose transactionId does not match the currently pending one — never reverses the wrong transaction', async () => {
      const { useCase, stateRepository, deleteTransaction } = buildUseCase();
      seedConfirmation(stateRepository);

      const outcome = await useCase.execute({
        userId: USER_ID,
        callbackData: 'undo:txn-DIFFERENT',
        currentDateTime: NOW,
      });

      expect(outcome).toEqual({ kind: 'stale' });
      expect(deleteTransaction.calls).toHaveLength(0);
    });

    it('a duplicate Undo tap after the first already transitioned state is safely reported stale, not reversed twice', async () => {
      const { useCase, stateRepository, draftRepository, deleteTransaction } = buildUseCase();
      seedConfirmation(stateRepository);
      draftRepository.seed({
        id: 'draft-1',
        userId: USER_ID,
        partialData: {} as never,
        missingFields: [],
        status: 'completed',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
        resolvedTransactionId: 'txn-1',
        createdAt: new Date(),
        lastInteractionAt: new Date(),
        deletedAt: null,
      });

      const first = await useCase.execute({
        userId: USER_ID,
        callbackData: 'undo:txn-1',
        currentDateTime: NOW,
      });
      const replay = await useCase.execute({
        userId: USER_ID,
        callbackData: 'undo:txn-1',
        currentDateTime: NOW,
      });

      expect(first.kind).toBe('undone');
      expect(replay).toEqual({ kind: 'stale' });
      expect(deleteTransaction.calls).toHaveLength(1);
    });
  });

  describe('TASK-BOT-006 — batch review callback actions', () => {
    function candidate(
      overrides: Partial<TransactionExtractionCandidate> = {},
    ): TransactionExtractionCandidate {
      return {
        intent: 'EXPENSE',
        amount: 12000,
        currency: 'UZS',
        category: 'FOOD_DINING',
        subcategory: null,
        merchant: null,
        paymentMethod: null,
        transactionDate: '2026-08-14',
        transactionTime: null,
        location: null,
        counterparty: null,
        dueDate: null,
        tags: [],
        description: 'Coffee',
        confidenceScores: {
          intent: 0.9,
          amount: 0.7,
          currency: 0.9,
          category: 0.6,
          transactionDate: 0.9,
        },
        ...overrides,
      };
    }

    function seedDraft(
      draftRepository: LocalFakeDraftRepository,
      id: string,
      overrides: Partial<TransactionDraftRecord> = {},
    ): void {
      draftRepository.seed({
        id,
        userId: USER_ID,
        partialData: candidate({ description: id }),
        missingFields: [],
        status: 'pending',
        originalText: 'bought coffee and lunch',
        sourceType: 'text',
        resolvedTransactionId: null,
        createdAt: new Date(),
        lastInteractionAt: new Date(),
        deletedAt: null,
        ...overrides,
      });
    }

    function seedBatchReview(
      stateRepository: LocalFakeConversationStateRepository,
      context: Partial<AwaitingMultiItemReviewContext> = {},
    ): void {
      const fullContext: AwaitingMultiItemReviewContext = {
        batchId: 'batch-1',
        totalItems: 3,
        highConfidenceDraftIds: ['draft-high-1'],
        lowConfidenceDraftIds: ['draft-low-1', 'draft-low-2'],
        currentIndex: 0,
        pendingCancelConfirmation: false,
        ...context,
      };
      stateRepository.seed({
        userId: USER_ID,
        state: 'AWAITING_MULTI_ITEM_REVIEW',
        contextPayload: fullContext,
        createdAt: NOW,
        expiresAt: '2026-08-15T10:00:00+05:00',
        version: 1,
      });
    }

    it('batch_confirm commits the current low-confidence item and advances to the next one', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCase();
      seedBatchReview(stateRepository);
      seedDraft(draftRepository, 'draft-low-1');
      seedDraft(draftRepository, 'draft-low-2');

      const outcome = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_confirm:draft-low-1',
        currentDateTime: NOW,
      });

      expect(outcome.kind).toBe('batch_item_confirmed');
      if (outcome.kind === 'batch_item_confirmed') {
        expect(outcome.transactionId).toBeTruthy();
        expect(outcome.nextCandidate?.description).toBe('draft-low-2');
        expect(outcome.nextPosition).toBe(2);
        expect(outcome.totalLowConfidence).toBe(2);
      }
      expect(commitPort.calls).toHaveLength(1);
      expect(commitPort.calls[0]?.draftId).toBe('draft-low-1');
      expect(draftRepository.records.get('draft-low-1')?.status).toBe('completed');

      const stored = await stateRepository.get(USER_ID);
      expect(stored?.state).toBe('AWAITING_MULTI_ITEM_REVIEW');
      const context = stored?.contextPayload as AwaitingMultiItemReviewContext;
      expect(context.currentIndex).toBe(1);
    });

    it('batch_confirm on the last low-confidence item completes the review (back to IDLE)', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCase();
      seedBatchReview(stateRepository, { currentIndex: 1 });
      seedDraft(draftRepository, 'draft-low-1', {
        status: 'completed',
        resolvedTransactionId: 'txn-prior',
      });
      seedDraft(draftRepository, 'draft-low-2');

      const outcome = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_confirm:draft-low-2',
        currentDateTime: NOW,
      });

      expect(outcome.kind).toBe('batch_item_confirmed');
      if (outcome.kind === 'batch_item_confirmed') {
        expect(outcome.nextCandidate).toBeNull();
        expect(outcome.nextPosition).toBeNull();
      }
      expect(commitPort.calls).toHaveLength(1);
      const stored = await stateRepository.get(USER_ID);
      expect(stored?.state).toBe('IDLE');
    });

    it('batch_skip does not commit and still advances review', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCase();
      seedBatchReview(stateRepository);
      seedDraft(draftRepository, 'draft-low-1');
      seedDraft(draftRepository, 'draft-low-2');

      const outcome = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_skip:draft-low-1',
        currentDateTime: NOW,
      });

      expect(outcome.kind).toBe('batch_item_skipped');
      expect(commitPort.calls).toHaveLength(0);
      expect(draftRepository.records.get('draft-low-1')?.status).toBe('pending');
      const stored = await stateRepository.get(USER_ID);
      const context = stored?.contextPayload as AwaitingMultiItemReviewContext;
      expect(context.currentIndex).toBe(1);
    });

    it('reports stale for a batch_confirm targeting a draft other than the current review position', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCase();
      seedBatchReview(stateRepository);
      seedDraft(draftRepository, 'draft-low-1');
      seedDraft(draftRepository, 'draft-low-2');

      const outcome = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_confirm:draft-low-2',
        currentDateTime: NOW,
      });

      expect(outcome).toEqual({ kind: 'stale' });
      expect(commitPort.calls).toHaveLength(0);
    });

    it('a duplicate batch_confirm tap after the position already advanced is safely reported stale, not committed twice', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCase();
      seedBatchReview(stateRepository);
      seedDraft(draftRepository, 'draft-low-1');
      seedDraft(draftRepository, 'draft-low-2');

      const first = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_confirm:draft-low-1',
        currentDateTime: NOW,
      });
      const replay = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_confirm:draft-low-1',
        currentDateTime: NOW,
      });

      expect(first.kind).toBe('batch_item_confirmed');
      expect(replay).toEqual({ kind: 'stale' });
      expect(commitPort.calls).toHaveLength(1);
    });

    it('reports batch_commit_failed and leaves state/draft untouched when the commit port rejects', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCase();
      seedBatchReview(stateRepository);
      seedDraft(draftRepository, 'draft-low-1');
      seedDraft(draftRepository, 'draft-low-2');
      commitPort.failFor.add('draft-low-1');

      const outcome = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_confirm:draft-low-1',
        currentDateTime: NOW,
      });

      expect(outcome).toEqual({
        kind: 'batch_commit_failed',
        reason: 'Simulated commit failure for draft-low-1',
      });
      expect(draftRepository.records.get('draft-low-1')?.status).toBe('pending');
      const stored = await stateRepository.get(USER_ID);
      const context = stored?.contextPayload as AwaitingMultiItemReviewContext;
      expect(context.currentIndex).toBe(0);
    });

    it('batch_commit_high commits every pending high-confidence draft, state-independent (conversation state untouched)', async () => {
      const { useCase, stateRepository, draftRepository } = buildUseCase();
      seedBatchReview(stateRepository, {
        highConfidenceDraftIds: ['draft-high-1', 'draft-high-2'],
      });
      seedDraft(draftRepository, 'draft-high-1');
      seedDraft(draftRepository, 'draft-high-2');
      seedDraft(draftRepository, 'draft-low-1');
      seedDraft(draftRepository, 'draft-low-2');

      const outcome = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_commit_high:batch-1',
        currentDateTime: NOW,
      });

      expect(outcome).toMatchObject({
        kind: 'batch_high_confidence_committed',
        committedCount: 2,
        failedCount: 0,
      });
      expect(draftRepository.records.get('draft-high-1')?.status).toBe('completed');
      expect(draftRepository.records.get('draft-high-2')?.status).toBe('completed');
      expect(draftRepository.records.get('draft-low-1')?.status).toBe('pending');
      const stored = await stateRepository.get(USER_ID);
      expect(stored?.state).toBe('AWAITING_MULTI_ITEM_REVIEW'); // untouched
      expect(stored?.version).toBe(1);
    });

    it('a duplicate batch_commit_high tap is idempotent — already-completed drafts are skipped, not re-committed', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCase();
      seedBatchReview(stateRepository, { highConfidenceDraftIds: ['draft-high-1'] });
      seedDraft(draftRepository, 'draft-high-1');

      const first = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_commit_high:batch-1',
        currentDateTime: NOW,
      });
      const replay = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_commit_high:batch-1',
        currentDateTime: NOW,
      });

      expect(first).toMatchObject({ kind: 'batch_high_confidence_committed', committedCount: 1 });
      expect(replay).toMatchObject({ kind: 'batch_high_confidence_committed', committedCount: 0 });
      expect(commitPort.calls).toHaveLength(1);
    });

    it('reports stale for a batch_commit_high whose batchId does not match the currently pending batch', async () => {
      const { useCase, stateRepository, commitPort } = buildUseCase();
      seedBatchReview(stateRepository);

      const outcome = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_commit_high:batch-DIFFERENT',
        currentDateTime: NOW,
      });

      expect(outcome).toEqual({ kind: 'stale' });
      expect(commitPort.calls).toHaveLength(0);
    });

    it('reports stale for a batch action when there is no pending batch review at all', async () => {
      const { useCase, commitPort } = buildUseCase();

      const outcome = await useCase.execute({
        userId: USER_ID,
        callbackData: 'batch_confirm:draft-low-1',
        currentDateTime: NOW,
      });

      expect(outcome).toEqual({ kind: 'stale' });
      expect(commitPort.calls).toHaveLength(0);
    });

    it('never commits/advances a batch review belonging to a different user (isolation)', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCase();
      seedBatchReview(stateRepository);
      seedDraft(draftRepository, 'draft-low-1');
      seedDraft(draftRepository, 'draft-low-2');

      const outcome = await useCase.execute({
        userId: 'user-OTHER',
        callbackData: 'batch_confirm:draft-low-1',
        currentDateTime: NOW,
      });

      expect(outcome).toEqual({ kind: 'stale' });
      expect(commitPort.calls).toHaveLength(0);
    });
  });
});
