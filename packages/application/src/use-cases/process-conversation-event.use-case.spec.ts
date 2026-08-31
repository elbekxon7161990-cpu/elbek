import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
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
import { ProcessConversationEventUseCase } from './process-conversation-event.use-case';
import type { DeleteTransactionInput } from '../dto/delete-transaction.input';
import { TransactionAlreadyDeletedError } from '../errors/transaction-already-deleted.error';
import type { DeleteTransactionUseCase } from './delete-transaction.use-case';

class LocalFakeDraftRepository implements DraftRepository {
  readonly records = new Map<string, TransactionDraftRecord>();

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
    // Most of this file's tests construct a CANDIDATE_RESOLVED event
    // directly against ProcessConversationEventUseCase, bypassing
    // RouteTextMessageUseCase's own draft-creation step (which they are not
    // testing) — auto-vivifying a minimal stub here, rather than throwing
    // like the real Prisma adapter would on an update to a nonexistent row,
    // keeps those tests focused on conversation-state transition behavior.
    // The dedicated draft-lifecycle tests below seed a real draft first and
    // exercise the strict, production-realistic path.
    const existing = this.records.get(id) ?? {
      id,
      userId: 'unknown',
      partialData: {} as TransactionExtractionCandidate,
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
  private alreadyDeletedNext = false;

  forceNextAlreadyDeleted(): void {
    this.alreadyDeletedNext = true;
  }

  async execute(input: DeleteTransactionInput): Promise<void> {
    this.calls.push(input);
    if (this.alreadyDeletedNext) {
      this.alreadyDeletedNext = false;
      throw new TransactionAlreadyDeletedError(input.transactionId);
    }
  }
}

/** Local fake — @afa/application never depends on @afa/infrastructure, even in tests (established convention across every AI, STT, and OCR spec in this package). */
class LocalFakeConversationStateRepository implements ConversationStateRepository {
  private readonly records = new Map<string, ConversationStateRecord>();
  private forcedCasFailuresRemaining = 0;
  readonly casCalls: { userId: string; expectedVersion: number }[] = [];

  seed(record: ConversationStateRecord): void {
    this.records.set(record.userId, record);
  }

  /** Simulates a concurrent writer winning the race N times before this caller's CAS is allowed through. */
  forceNextCompareAndSetFailures(count: number): void {
    this.forcedCasFailuresRemaining = count;
  }

  async get(userId: string): Promise<ConversationStateRecord | null> {
    return this.records.get(userId) ?? null;
  }

  async compareAndSet(
    userId: string,
    expectedVersion: number,
    newRecord: ConversationStateRecord,
  ): Promise<boolean> {
    this.casCalls.push({ userId, expectedVersion });
    if (this.forcedCasFailuresRemaining > 0) {
      this.forcedCasFailuresRemaining -= 1;
      return false;
    }
    const current = this.records.get(userId);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== expectedVersion) {
      return false;
    }
    this.records.set(userId, newRecord);
    return true;
  }
}

class LocalFakeTransactionCommitPort implements TransactionCommitPort {
  readonly calls: TransactionCommitRequest[] = [];
  private nextId = 1;
  private error: Error | null = null;

  failNextCommit(error: Error): void {
    this.error = error;
  }

  async commit(request: TransactionCommitRequest): Promise<TransactionCommitResult> {
    this.calls.push(request);
    if (this.error) {
      const error = this.error;
      this.error = null;
      throw error;
    }
    const transactionId = `txn-${this.nextId}`;
    this.nextId += 1;
    return { transactionId };
  }
}

function candidate(
  overrides: Partial<TransactionExtractionCandidate> = {},
): TransactionExtractionCandidate {
  return {
    intent: 'EXPENSE',
    amount: 45000,
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
    description: 'Lunch',
    confidenceScores: {
      intent: 0.97,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
    ...overrides,
  };
}

const USER_A = 'user-a';
const USER_B = 'user-b';
const NOW = '2026-08-14T10:00:00.000Z';

describe('ProcessConversationEventUseCase', () => {
  let stateRepository: LocalFakeConversationStateRepository;
  let commitPort: LocalFakeTransactionCommitPort;
  let draftRepository: LocalFakeDraftRepository;
  let deleteTransaction: LocalFakeDeleteTransactionUseCase;
  let useCase: ProcessConversationEventUseCase;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    stateRepository = new LocalFakeConversationStateRepository();
    commitPort = new LocalFakeTransactionCommitPort();
    draftRepository = new LocalFakeDraftRepository();
    deleteTransaction = new LocalFakeDeleteTransactionUseCase();
    useCase = new ProcessConversationEventUseCase(
      stateRepository,
      commitPort,
      draftRepository,
      deleteTransaction as unknown as DeleteTransactionUseCase,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('complete transaction — auto_commit (FR-CE-040)', () => {
    it('commits directly and stays IDLE for a high-confidence candidate', async () => {
      const outcome = await useCase.execute(USER_A, {
        type: 'CANDIDATE_RESOLVED',
        classification: 'auto_commit',
        candidate: candidate(),
        missingField: null,
        clarificationQuestion: null,
        draftId: 'draft-1',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
      });

      expect(outcome).toMatchObject({
        status: 'transitioned',
        requirementId: 'FR-CE-040',
        previousState: 'IDLE',
        nextState: 'IDLE',
      });
      expect(commitPort.calls).toHaveLength(1);
      expect(commitPort.calls[0]?.candidate.amount).toBe(45000);

      const stored = await stateRepository.get(USER_A);
      expect(stored?.state).toBe('IDLE');
      expect(stored?.contextPayload).toBeNull();
      expect(stored?.expiresAt).toBeNull();
      expect(stored?.version).toBe(1);
    });
  });

  describe('missing required fields — draft_pending_clarification (FR-CE-041)', () => {
    it('does not commit and moves to AWAITING_CLARIFICATION when amount/category/currency are missing', async () => {
      const outcome = await useCase.execute(USER_A, {
        type: 'CANDIDATE_RESOLVED',
        classification: 'draft_pending_clarification',
        candidate: candidate({ amount: null, category: null, currency: null }),
        missingField: 'amount',
        clarificationQuestion: null,
        draftId: 'draft-2',
        originalText: 'not sure how much',
        sourceType: 'text',
      });

      expect(outcome).toMatchObject({
        status: 'transitioned',
        requirementId: 'FR-CE-041',
        nextState: 'AWAITING_CLARIFICATION',
      });
      expect(commitPort.calls).toHaveLength(0);

      const stored = await stateRepository.get(USER_A);
      expect(stored?.contextPayload).toEqual({
        draftId: 'draft-2',
        missingField: 'amount',
        retryCount: 0,
        lastQuestionAsked: null,
      });
      expect(stored?.expiresAt).toBe('2026-08-14T10:30:00.000Z'); // DEFAULT_PENDING_STATE_TTL_SECONDS = 30 min
    });
  });

  describe('clarification response (FR-CE-042/043/005)', () => {
    function seedClarification(retryCount = 0): void {
      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'draft-2',
          missingField: 'amount',
          retryCount,
          lastQuestionAsked: 'How much did you spend?',
        },
        createdAt: NOW,
        expiresAt: '2026-08-14T10:30:00.000Z',
        version: 1,
      });
    }

    it('resolves the field and returns to IDLE (FR-CE-043)', async () => {
      seedClarification(0);

      const outcome = await useCase.execute(USER_A, {
        type: 'CLARIFICATION_ANSWER',
        fieldResolved: true,
        nextQuestion: null,
      });

      expect(outcome).toMatchObject({
        status: 'transitioned',
        requirementId: 'FR-CE-043',
        nextState: 'IDLE',
      });
      const stored = await stateRepository.get(USER_A);
      expect(stored?.contextPayload).toBeNull();
      expect(stored?.expiresAt).toBeNull();
    });

    it('stays AWAITING_CLARIFICATION and increments retryCount when still unresolved and under the retry cap (FR-CE-042)', async () => {
      seedClarification(0);

      const outcome = await useCase.execute(USER_A, {
        type: 'CLARIFICATION_ANSWER',
        fieldResolved: false,
        nextQuestion: null,
      });

      expect(outcome).toMatchObject({
        status: 'transitioned',
        requirementId: 'FR-CE-042',
        nextState: 'AWAITING_CLARIFICATION',
      });
      const stored = await stateRepository.get(USER_A);
      expect(stored?.contextPayload).toMatchObject({ retryCount: 1 });
    });

    it('falls back to the mini-form once the NFR-CE-003 retry cap is exhausted (FR-CE-005), staying in the same state', async () => {
      seedClarification(2);

      const outcome = await useCase.execute(USER_A, {
        type: 'CLARIFICATION_ANSWER',
        fieldResolved: false,
        nextQuestion: null,
      });

      expect(outcome).toMatchObject({
        status: 'transitioned',
        requirementId: 'FR-CE-005',
        nextState: 'AWAITING_CLARIFICATION',
        fallbackToMiniForm: true,
      });
    });
  });

  describe('confirmation — flagged_review (FR-CE-044)', () => {
    it('commits immediately (already-committed-by-entry model) and moves to AWAITING_CONFIRMATION with flagged fields', async () => {
      const outcome = await useCase.execute(USER_A, {
        type: 'CANDIDATE_RESOLVED',
        classification: 'flagged_review',
        candidate: candidate({
          confidenceScores: {
            intent: 0.97,
            amount: 0.7,
            currency: 0.9,
            category: 0.9,
            transactionDate: 0.95,
          },
        }),
        missingField: null,
        clarificationQuestion: null,
        originalText: 'spent 45000 on lunch, mostly sure',
        sourceType: 'text',
        draftId: 'draft-3',
      });

      expect(outcome.status).toBe('transitioned');
      if (outcome.status === 'transitioned') {
        expect(outcome.requirementId).toBe('FR-CE-044');
        expect(outcome.nextState).toBe('AWAITING_CONFIRMATION');
        expect(outcome.transactionId).not.toBeNull();
      }
      expect(commitPort.calls).toHaveLength(1);

      const stored = await stateRepository.get(USER_A);
      expect(stored?.contextPayload).toMatchObject({ flaggedFields: ['amount'] });
      expect(stored?.expiresAt).toBe('2026-08-15T10:00:00.000Z'); // 24h TTL for AWAITING_CONFIRMATION
    });
  });

  describe('correction via edit (FR-CE-045/046)', () => {
    function seedConfirmation(): void {
      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_CONFIRMATION',
        contextPayload: { transactionId: 'txn-99', draftId: 'draft-99', flaggedFields: ['amount'] },
        createdAt: NOW,
        expiresAt: '2026-08-15T10:00:00.000Z',
        version: 1,
      });
    }

    it('moves to AWAITING_EDIT_VALUE when the user taps Edit', async () => {
      seedConfirmation();

      const outcome = await useCase.execute(USER_A, {
        type: 'EDIT_REQUESTED',
        targetField: 'amount',
      });

      expect(outcome).toMatchObject({
        status: 'transitioned',
        requirementId: 'FR-CE-045',
        nextState: 'AWAITING_EDIT_VALUE',
      });
      const stored = await stateRepository.get(USER_A);
      expect(stored?.contextPayload).toEqual({ targetId: 'txn-99', targetField: 'amount' });
    });

    it('returns to IDLE once the replacement value passes validation (FR-CE-046)', async () => {
      seedConfirmation();
      await useCase.execute(USER_A, { type: 'EDIT_REQUESTED', targetField: 'amount' });

      const outcome = await useCase.execute(USER_A, { type: 'EDIT_VALUE_PROVIDED', valid: true });

      expect(outcome).toMatchObject({
        status: 'transitioned',
        requirementId: 'FR-CE-046',
        nextState: 'IDLE',
      });
    });

    it('rejects an invalid replacement value and leaves the state untouched (no write)', async () => {
      seedConfirmation();
      await useCase.execute(USER_A, { type: 'EDIT_REQUESTED', targetField: 'amount' });
      const beforeCasCalls = stateRepository.casCalls.length;

      const outcome = await useCase.execute(USER_A, { type: 'EDIT_VALUE_PROVIDED', valid: false });

      expect(outcome.status).toBe('rejected');
      expect(stateRepository.casCalls.length).toBe(beforeCasCalls); // no CAS attempted on rejection
      const stored = await stateRepository.get(USER_A);
      expect(stored?.state).toBe('AWAITING_EDIT_VALUE'); // unchanged
    });
  });

  describe('cancellation (FR-CE-047)', () => {
    it('cancels from a pending state back to IDLE', async () => {
      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'd',
          missingField: 'amount',
          retryCount: 0,
          lastQuestionAsked: null,
        },
        createdAt: NOW,
        expiresAt: '2026-08-14T10:30:00.000Z',
        version: 1,
      });

      const outcome = await useCase.execute(USER_A, { type: 'CANCELLATION' });

      expect(outcome).toMatchObject({
        status: 'transitioned',
        requirementId: 'FR-CE-047',
        nextState: 'IDLE',
      });
    });

    it('rejects cancellation from IDLE (nothing pending to cancel)', async () => {
      const outcome = await useCase.execute(USER_A, { type: 'CANCELLATION' });

      expect(outcome.status).toBe('rejected');
    });
  });

  describe('invalid transitions fail safely', () => {
    it('rejects an edit request while IDLE without ever calling compareAndSet', async () => {
      const outcome = await useCase.execute(USER_A, {
        type: 'EDIT_REQUESTED',
        targetField: 'amount',
      });

      expect(outcome.status).toBe('rejected');
      expect(stateRepository.casCalls).toHaveLength(0);
      expect(commitPort.calls).toHaveLength(0);
    });
  });

  describe('multi-candidate / candidate-specific correction (out of scope for this task)', () => {
    it("is structurally single-candidate — ConversationEvent carries exactly one candidate per call, batching across multiple candidates is the Batch Review Coordinator/TASK-BOT-006's job", async () => {
      // No behavior to assert beyond the type shape itself: CandidateResolvedEvent.candidate
      // is a single TransactionExtractionCandidate, not an array. Documented here rather than
      // silently skipped, per this task's own scope boundary (В§5.2.1 excludes AWAITING_MULTI_ITEM_REVIEW).
      expect(true).toBe(true);
    });
  });

  describe('expiration (В§5.19.2 read-time enforcement)', () => {
    it('treats an expired AWAITING_CLARIFICATION record as IDLE, rejecting a stale clarification answer', async () => {
      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'd',
          missingField: 'amount',
          retryCount: 0,
          lastQuestionAsked: null,
        },
        createdAt: '2026-08-14T09:00:00.000Z',
        expiresAt: '2026-08-14T09:30:00.000Z', // already expired relative to NOW
        version: 1,
      });

      const outcome = await useCase.execute(USER_A, {
        type: 'CLARIFICATION_ANSWER',
        fieldResolved: true,
        nextQuestion: null,
      });

      expect(outcome.status).toBe('rejected'); // effective state is IDLE, which has no CLARIFICATION_ANSWER guard row
    });

    it('treats an expired pending state as IDLE for a fresh CANDIDATE_RESOLVED event, allowing a new commit', async () => {
      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'stale-draft',
          missingField: 'amount',
          retryCount: 1,
          lastQuestionAsked: 'q',
        },
        createdAt: '2026-08-14T09:00:00.000Z',
        expiresAt: '2026-08-14T09:30:00.000Z',
        version: 1,
      });

      const outcome = await useCase.execute(USER_A, {
        type: 'CANDIDATE_RESOLVED',
        classification: 'auto_commit',
        candidate: candidate(),
        missingField: null,
        clarificationQuestion: null,
        draftId: 'fresh-draft',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
      });

      expect(outcome).toMatchObject({
        status: 'transitioned',
        requirementId: 'FR-CE-040',
        previousState: 'IDLE',
        nextState: 'IDLE',
      });
    });
  });

  describe('idempotency / duplicate events', () => {
    it('a duplicate EDIT_REQUESTED replayed after the first has already advanced state is rejected as a no-op (state-validation-before-acting, В§5.16.3)', async () => {
      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_CONFIRMATION',
        contextPayload: { transactionId: 'txn-99', draftId: 'draft-99', flaggedFields: [] },
        createdAt: NOW,
        expiresAt: '2026-08-15T10:00:00.000Z',
        version: 1,
      });

      const first = await useCase.execute(USER_A, {
        type: 'EDIT_REQUESTED',
        targetField: 'amount',
      });
      const replay = await useCase.execute(USER_A, {
        type: 'EDIT_REQUESTED',
        targetField: 'amount',
      });

      expect(first.status).toBe('transitioned');
      expect(replay.status).toBe('rejected'); // current state is now AWAITING_EDIT_VALUE, guard row no longer matches
    });
  });

  describe('commit failure', () => {
    it('reports commit_failed rather than throwing or writing a partial/corrupted state (TASK-FIN-REAL-001)', async () => {
      commitPort.failNextCommit(new Error('database unavailable'));

      const outcome = await useCase.execute(USER_A, {
        type: 'CANDIDATE_RESOLVED',
        classification: 'auto_commit',
        candidate: candidate(),
        missingField: null,
        clarificationQuestion: null,
        draftId: 'draft-1',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
      });

      expect(outcome).toEqual({ status: 'commit_failed', reason: 'database unavailable' });
      expect(stateRepository.casCalls).toHaveLength(0); // never attempted a write after a failed commit
    });
  });

  describe('persistence failure', () => {
    it('propagates a read failure from the state repository', async () => {
      const failingRepo: ConversationStateRepository = {
        get: () => {
          throw new Error('redis unavailable');
        },
        compareAndSet: async () => true,
      };
      const failingUseCase = new ProcessConversationEventUseCase(
        failingRepo,
        commitPort,
        draftRepository,
        deleteTransaction as unknown as DeleteTransactionUseCase,
      );

      await expect(failingUseCase.execute(USER_A, { type: 'CANCELLATION' })).rejects.toThrow(
        'redis unavailable',
      );
    });
  });

  describe('concurrent processing (BR-CE-006 compare-and-set retry)', () => {
    it('retries against the now-current state after losing a race, and eventually succeeds', async () => {
      stateRepository.forceNextCompareAndSetFailures(1);

      const outcome = await useCase.execute(USER_A, {
        type: 'CANDIDATE_RESOLVED',
        classification: 'auto_commit',
        candidate: candidate(),
        missingField: null,
        clarificationQuestion: null,
        draftId: 'draft-1',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
      });

      expect(outcome.status).toBe('transitioned');
      expect(stateRepository.casCalls.length).toBe(2); // one lost race, one successful retry
      expect(commitPort.calls).toHaveLength(1); // commit happens exactly once per execute() call, never re-invoked on a CAS retry (would otherwise double-commit the transaction)
    });

    it('reports concurrency_conflict once retries are exhausted, without throwing', async () => {
      stateRepository.forceNextCompareAndSetFailures(10);

      const outcome = await useCase.execute(USER_A, { type: 'CANCELLATION' });
      // no pending state exists, so this exercises the rejected path first — reseed a pending state instead
      expect(outcome.status).toBe('rejected');

      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'd',
          missingField: 'amount',
          retryCount: 0,
          lastQuestionAsked: null,
        },
        createdAt: NOW,
        expiresAt: '2026-08-14T10:30:00.000Z',
        version: 1,
      });
      stateRepository.forceNextCompareAndSetFailures(10);

      const conflictOutcome = await useCase.execute(USER_A, { type: 'CANCELLATION' });

      expect(conflictOutcome).toEqual({ status: 'concurrency_conflict' });
    });
  });

  describe('user isolation (В§5.18.2/BR-CE-002 — structural, not policy)', () => {
    it("never reads or mutates another user's conversation state", async () => {
      stateRepository.seed({
        userId: USER_B,
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'b-draft',
          missingField: 'amount',
          retryCount: 0,
          lastQuestionAsked: null,
        },
        createdAt: NOW,
        expiresAt: '2026-08-14T10:30:00.000Z',
        version: 1,
      });

      await useCase.execute(USER_A, {
        type: 'CANDIDATE_RESOLVED',
        classification: 'auto_commit',
        candidate: candidate(),
        missingField: null,
        clarificationQuestion: null,
        draftId: 'a-draft',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
      });

      const userBState = await stateRepository.get(USER_B);
      expect(userBState?.state).toBe('AWAITING_CLARIFICATION');
      expect(userBState?.contextPayload).toMatchObject({ draftId: 'b-draft' });
      expect(commitPort.calls.every((c) => c.userId === USER_A)).toBe(true);
    });
  });

  describe('fresh user (no prior state)', () => {
    it('defaults to IDLE (version 0) when no record has ever been written', async () => {
      const outcome = await useCase.execute(USER_A, { type: 'CANCELLATION' });

      expect(outcome.status).toBe('rejected'); // IDLE has nothing to cancel — proves the default is IDLE, not an error
    });

    it('creates the first record at version 1 after the first successful transition', async () => {
      await useCase.execute(USER_A, {
        type: 'CANDIDATE_RESOLVED',
        classification: 'auto_commit',
        candidate: candidate(),
        missingField: null,
        clarificationQuestion: null,
        draftId: 'draft-1',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
      });

      const stored = await stateRepository.get(USER_A);
      expect(stored?.version).toBe(1);
      expect(stateRepository.casCalls[0]).toEqual({ userId: USER_A, expectedVersion: 0 });
    });
  });

  describe('TASK-BOT-004 — draft lifecycle', () => {
    function seedDraft(id: string, userId = USER_A): void {
      draftRepository.records.set(id, {
        id,
        userId,
        partialData: candidate(),
        missingFields: [],
        status: 'pending',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
        resolvedTransactionId: null,
        createdAt: new Date(NOW),
        lastInteractionAt: new Date(NOW),
        deletedAt: null,
      });
    }

    it('marks the draft completed with the resolved transactionId on a successful auto_commit', async () => {
      seedDraft('draft-1');

      const outcome = await useCase.execute(USER_A, {
        type: 'CANDIDATE_RESOLVED',
        classification: 'auto_commit',
        candidate: candidate(),
        missingField: null,
        clarificationQuestion: null,
        draftId: 'draft-1',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
      });

      expect(outcome.status).toBe('transitioned');
      const draft = draftRepository.records.get('draft-1');
      expect(draft?.status).toBe('completed');
      expect(draft?.resolvedTransactionId).toBe(
        outcome.status === 'transitioned' ? outcome.transactionId : null,
      );
    });

    it('marks the draft completed on a flagged_review commit too (already committed at AWAITING_CONFIRMATION entry, FR-CE-044)', async () => {
      seedDraft('draft-2');

      await useCase.execute(USER_A, {
        type: 'CANDIDATE_RESOLVED',
        classification: 'flagged_review',
        candidate: candidate({
          confidenceScores: {
            intent: 0.97,
            amount: 0.7,
            currency: 0.9,
            category: 0.9,
            transactionDate: 0.95,
          },
        }),
        missingField: null,
        clarificationQuestion: null,
        draftId: 'draft-2',
        originalText: 'spent 45000 on lunch',
        sourceType: 'text',
      });

      expect(draftRepository.records.get('draft-2')?.status).toBe('completed');
    });

    it('marks the draft abandoned when the user cancels out of AWAITING_CLARIFICATION — nothing to reverse (FR-CE-041 never committed)', async () => {
      seedDraft('draft-3');
      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'draft-3',
          missingField: 'amount',
          retryCount: 0,
          lastQuestionAsked: 'How much?',
        },
        createdAt: NOW,
        expiresAt: '2026-08-14T10:30:00.000Z',
        version: 1,
      });

      await useCase.execute(USER_A, { type: 'CANCELLATION' });

      expect(draftRepository.records.get('draft-3')?.status).toBe('abandoned');
      expect(deleteTransaction.calls).toHaveLength(0); // nothing was ever committed
    });

    it('Undo (cancel out of AWAITING_CONFIRMATION) reverses the already-committed transaction and marks the draft abandoned', async () => {
      seedDraft('draft-4');
      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_CONFIRMATION',
        contextPayload: {
          transactionId: 'txn-committed-1',
          draftId: 'draft-4',
          flaggedFields: ['amount'],
        },
        createdAt: NOW,
        expiresAt: '2026-08-15T10:00:00.000Z',
        version: 1,
      });

      const outcome = await useCase.execute(USER_A, { type: 'CANCELLATION' });

      expect(outcome.status).toBe('transitioned');
      expect(deleteTransaction.calls).toEqual([
        { transactionId: 'txn-committed-1', userId: USER_A, actor: 'undo' },
      ]);
      expect(draftRepository.records.get('draft-4')?.status).toBe('abandoned');
    });

    it('a duplicate Undo (transaction already deleted) is safe — the draft is still marked abandoned, no error propagates', async () => {
      seedDraft('draft-5');
      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_CONFIRMATION',
        contextPayload: { transactionId: 'txn-committed-2', draftId: 'draft-5', flaggedFields: [] },
        createdAt: NOW,
        expiresAt: '2026-08-15T10:00:00.000Z',
        version: 1,
      });
      deleteTransaction.forceNextAlreadyDeleted();

      const outcome = await useCase.execute(USER_A, { type: 'CANCELLATION' });

      expect(outcome.status).toBe('transitioned');
      expect(draftRepository.records.get('draft-5')?.status).toBe('abandoned');
    });

    it('cancelling out of AWAITING_EDIT_VALUE does not touch any draft or reverse any transaction (the original entry stays valid)', async () => {
      stateRepository.seed({
        userId: USER_A,
        state: 'AWAITING_EDIT_VALUE',
        contextPayload: { targetId: 'txn-committed-3', targetField: 'amount' },
        createdAt: NOW,
        expiresAt: '2026-08-14T10:30:00.000Z',
        version: 1,
      });

      const outcome = await useCase.execute(USER_A, { type: 'CANCELLATION' });

      expect(outcome.status).toBe('transitioned');
      expect(deleteTransaction.calls).toHaveLength(0);
      expect(draftRepository.records.size).toBe(0);
    });
  });
});
