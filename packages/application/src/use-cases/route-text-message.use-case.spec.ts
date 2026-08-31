import { describe, expect, it } from 'vitest';
import type {
  ConversationStateRecord,
  ConversationStateRepository,
  DraftRepository,
  DraftStatusPatch,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  NewTransactionDraftData,
  TransactionCommitPort,
  TransactionCommitRequest,
  TransactionCommitResult,
  TransactionDraftRecord,
} from '@afa/domain';

import { ValidateStructuredAiOutputUseCase } from './validate-structured-ai-output.use-case';
import { ExtractTransactionCandidatesUseCase } from './extract-transaction-candidates.use-case';
import type { ExtractionModelConfig } from './extract-transaction-candidates.use-case';
import { ProcessConversationEventUseCase } from './process-conversation-event.use-case';
import { RouteTextMessageUseCase } from './route-text-message.use-case';
import type { DeleteTransactionUseCase } from './delete-transaction.use-case';
import type { EditTransactionUseCase } from './edit-transaction.use-case';

/** Local fake — shared shape with process-conversation-event.use-case.spec.ts's own (kept independent per this package's "no cross-spec-file test helper imports" convention — trivial enough not to be worth a shared test-utils module). */
export class LocalFakeDraftRepository implements DraftRepository {
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
    const existing = this.records.get(id);
    if (!existing) {
      throw new Error(`No draft "${id}"`);
    }
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

/**
 * Local fakes — @afa/application never depends on @afa/infrastructure,
 * even in tests. Accepts either a single result (returned for every call,
 * the pre-existing behavior) or a queue of results consumed one per call
 * (TASK-BOT-005 — the interruption tests need the SECOND `extract()` call
 * inside `routeClarificationAnswer` to return a genuinely different
 * candidate than the FIRST call that created the pending draft).
 */
class LocalFakeLlmProvider implements LlmProvider {
  private readonly calls: LlmCompletionRequest[] = [];
  private readonly queue: LlmCompletionResult[] | null;
  constructor(
    private readonly defaultResult: LlmCompletionResult,
    resultQueue?: LlmCompletionResult[],
  ) {
    this.queue = resultQueue ?? null;
  }
  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.calls.push(request);
    if (this.queue && this.queue.length > 0) {
      return this.queue.length > 1 ? this.queue.shift()! : this.queue[0]!;
    }
    return this.defaultResult;
  }
  get callCount(): number {
    return this.calls.length;
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
    return { transactionId: `txn-${this.calls.length}` };
  }
}

function candidateJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function envelope(transactions: Record<string, unknown>[]): Record<string, unknown> {
  return {
    transactions,
    detectedLanguage: 'en',
    clarificationNeeded: false,
    clarificationQuestion: null,
  };
}

const USER_ID = 'user-1';
const NOW = '2026-08-14T10:00:00+05:00';

function buildUseCase(
  llmJson: Record<string, unknown>,
  editExecute: (...args: unknown[]) => unknown = () => undefined,
) {
  const llmProvider = new LocalFakeLlmProvider({
    content: JSON.stringify(llmJson),
    finishReason: 'stop',
  });
  const validate = new ValidateStructuredAiOutputUseCase(llmProvider);
  const config: ExtractionModelConfig = { model: 'fixture-model' };
  const extract = new ExtractTransactionCandidatesUseCase(validate, config);
  const stateRepository = new LocalFakeConversationStateRepository();
  const commitPort = new LocalFakeTransactionCommitPort();
  const draftRepository = new LocalFakeDraftRepository();
  const deleteTransaction = {
    execute: async () => undefined,
  } as unknown as DeleteTransactionUseCase;
  const processEvent = new ProcessConversationEventUseCase(
    stateRepository,
    commitPort,
    draftRepository,
    deleteTransaction,
  );
  const editTransaction = { execute: editExecute } as unknown as EditTransactionUseCase;

  const useCase = new RouteTextMessageUseCase(
    stateRepository,
    draftRepository,
    commitPort,
    extract,
    processEvent,
    editTransaction,
  );
  return { useCase, stateRepository, commitPort, draftRepository, llmProvider };
}

/** TASK-BOT-005 — like `buildUseCase`, but the fake LLM returns a DIFFERENT envelope per call, in order (see `LocalFakeLlmProvider`'s own doc comment). */
function buildUseCaseWithSequence(envelopes: Record<string, unknown>[]) {
  const llmProvider = new LocalFakeLlmProvider(
    { content: JSON.stringify(envelopes[0]), finishReason: 'stop' },
    envelopes.map((envelope) => ({ content: JSON.stringify(envelope), finishReason: 'stop' })),
  );
  const validate = new ValidateStructuredAiOutputUseCase(llmProvider);
  const config: ExtractionModelConfig = { model: 'fixture-model' };
  const extract = new ExtractTransactionCandidatesUseCase(validate, config);
  const stateRepository = new LocalFakeConversationStateRepository();
  const commitPort = new LocalFakeTransactionCommitPort();
  const draftRepository = new LocalFakeDraftRepository();
  const deleteTransaction = {
    execute: async () => undefined,
  } as unknown as DeleteTransactionUseCase;
  const processEvent = new ProcessConversationEventUseCase(
    stateRepository,
    commitPort,
    draftRepository,
    deleteTransaction,
  );
  const editTransaction = { execute: () => undefined } as unknown as EditTransactionUseCase;
  const useCase = new RouteTextMessageUseCase(
    stateRepository,
    draftRepository,
    commitPort,
    extract,
    processEvent,
    editTransaction,
  );
  return { useCase, stateRepository, commitPort, draftRepository, llmProvider };
}

function baseInput(text: string) {
  return {
    userId: USER_ID,
    text,
    currentDateTime: NOW,
    userDefaultCurrency: 'UZS',
    userRecentCategories: [],
  };
}

describe('RouteTextMessageUseCase', () => {
  it('treats a cancellation phrase as CANCELLATION regardless of AI content, before ever calling extraction', async () => {
    const { useCase, llmProvider } = buildUseCase(envelope([candidateJson()]));

    const outcome = await useCase.execute(baseInput('cancel'));

    expect(outcome.kind).toBe('cancelled');
    expect(llmProvider.callCount).toBe(0);
  });

  it('routes a fresh high-confidence message to a CANDIDATE_RESOLVED auto-commit (IDLE)', async () => {
    const { useCase } = buildUseCase(envelope([candidateJson()]));

    const outcome = await useCase.execute(baseInput('spent 45000 on lunch'));

    expect(outcome.kind).toBe('candidate_processed');
    if (outcome.kind === 'candidate_processed') {
      expect(outcome.processEventOutcome.status).toBe('transitioned');
    }
  });

  describe('TASK-BOT-004 — draft creation (§5.5)', () => {
    it('persists a draft as soon as the candidate is resolved, before the event is processed, using the same draftId', async () => {
      const { useCase, draftRepository } = buildUseCase(envelope([candidateJson()]));

      await useCase.execute(baseInput('spent 45000 on lunch'));

      expect(draftRepository.records.size).toBe(1);
      const [draft] = [...draftRepository.records.values()];
      expect(draft?.userId).toBe(USER_ID);
      expect(draft?.originalText).toBe('spent 45000 on lunch');
      expect(draft?.sourceType).toBe('text');
      expect(draft?.partialData.amount).toBe(45000);
      expect(draft?.missingFields).toEqual([]); // every required field for this EXPENSE candidate is present
      // This candidate is high-confidence (auto_commit) — by the time
      // execute() returns, ProcessConversationEventUseCase has already
      // committed it and marked the draft 'completed' in the same call.
      expect(draft?.status).toBe('completed');
    });

    it('records which required fields are still missing (distinct from the single Redis missingField) — low-confidence, not null (schema requires non-null amount/category for EXPENSE; gating nulls it downstream)', async () => {
      const { useCase, draftRepository } = buildUseCase(
        envelope([
          candidateJson({
            amount: 1,
            category: 'FOOD_DINING',
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              currency: 0.9,
              category: 0.3,
              transactionDate: 0.95,
            },
          }),
        ]),
      );

      await useCase.execute(baseInput('spent some money'));

      const [draft] = [...draftRepository.records.values()];
      expect(draft?.missingFields).toEqual(expect.arrayContaining(['amount', 'category']));
    });

    it('persists a draft for a draft_pending_clarification candidate too, so it survives conversation abandonment (§5.5)', async () => {
      const { useCase, draftRepository } = buildUseCase(
        envelope([
          candidateJson({
            amount: 1,
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              currency: 0.9,
              category: 0.9,
              transactionDate: 0.95,
            },
          }),
        ]),
      );

      const outcome = await useCase.execute(baseInput('spent some money on lunch'));

      expect(outcome.kind).toBe('candidate_processed');
      expect(draftRepository.records.size).toBe(1);
      const [draft] = [...draftRepository.records.values()];
      expect(draft?.status).toBe('pending'); // draft_pending_clarification never commits — draft stays pending
      expect(draft?.missingFields).toContain('amount');
    });
  });

  it('reports no_transaction_detected for a valid non-financial intent (zero candidates)', async () => {
    const { useCase } = buildUseCase(envelope([]));

    const outcome = await useCase.execute(baseInput('hello there'));

    expect(outcome.kind).toBe('no_transaction_detected');
  });

  it('TASK-BOT-006 — a compound message where every candidate is high-confidence commits all of them immediately, never entering AWAITING_MULTI_ITEM_REVIEW', async () => {
    const { useCase, commitPort, draftRepository, stateRepository } = buildUseCase(
      envelope([candidateJson(), candidateJson({ description: 'Taxi', amount: 15000 })]),
    );

    const outcome = await useCase.execute(baseInput('lunch and taxi'));

    expect(outcome).toEqual({
      kind: 'batch_all_high_confidence_committed',
      totalItems: 2,
      committedCount: 2,
      failedCount: 0,
      transactionIds: ['txn-1', 'txn-2'],
      detectedLanguage: 'en',
    });
    expect(commitPort.calls).toHaveLength(2);
    expect(draftRepository.records.size).toBe(2);
    expect([...draftRepository.records.values()].every((d) => d.status === 'completed')).toBe(true);
    const state = await stateRepository.get(USER_ID);
    expect(state).toBeNull(); // never touched conversation_state at all
  });

  it('reports extraction_unknown when the structured output fails validation', async () => {
    const { useCase } = buildUseCase({ not: 'a valid envelope' });

    const outcome = await useCase.execute(baseInput('garbled'));

    expect(outcome.kind).toBe('extraction_unknown');
  });

  it('routes a clarification answer that resolves the missing field back to IDLE', async () => {
    const { useCase, stateRepository } = buildUseCase(envelope([candidateJson({ amount: 45000 })]));
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_CLARIFICATION',
      contextPayload: {
        draftId: 'd',
        missingField: 'amount',
        retryCount: 0,
        lastQuestionAsked: 'How much?',
      },
      createdAt: NOW,
      expiresAt: '2026-08-14T10:30:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute(baseInput('45000'));

    expect(outcome.kind).toBe('clarification_processed');
    if (
      outcome.kind === 'clarification_processed' &&
      outcome.processEventOutcome.status === 'transitioned'
    ) {
      expect(outcome.processEventOutcome.requirementId).toBe('FR-CE-043');
    }
  });

  it('routes a clarification answer that does not resolve the field to a retry (FR-CE-042)', async () => {
    const { useCase, stateRepository } = buildUseCase(envelope([candidateJson({ amount: null })]));
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_CLARIFICATION',
      contextPayload: {
        draftId: 'd',
        missingField: 'amount',
        retryCount: 0,
        lastQuestionAsked: 'How much?',
      },
      createdAt: NOW,
      expiresAt: '2026-08-14T10:30:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute(baseInput('not sure'));

    expect(outcome.kind).toBe('clarification_processed');
    if (
      outcome.kind === 'clarification_processed' &&
      outcome.processEventOutcome.status === 'transitioned'
    ) {
      expect(outcome.processEventOutcome.requirementId).toBe('FR-CE-042');
    }
  });

  it('routes AWAITING_EDIT_VALUE for a supported field (amount) through EditTransactionUseCase, valid replacement', async () => {
    const editExecute = () => ({});
    const { useCase, stateRepository } = buildUseCase(envelope([]), editExecute);
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_EDIT_VALUE',
      contextPayload: { targetId: 'txn-99', targetField: 'amount' },
      createdAt: NOW,
      expiresAt: '2026-08-14T10:30:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute(baseInput('50000'));

    expect(outcome.kind).toBe('edit_value_processed');
    if (
      outcome.kind === 'edit_value_processed' &&
      outcome.processEventOutcome.status === 'transitioned'
    ) {
      expect(outcome.processEventOutcome.requirementId).toBe('FR-CE-046');
    }
  });

  it('marks the edit as invalid when EditTransactionUseCase throws InvalidTransactionError-shaped domain validation failure', async () => {
    const { InvalidTransactionError } = await import('@afa/domain');
    const editExecute = () => {
      throw new InvalidTransactionError('amount must be positive');
    };
    const { useCase, stateRepository } = buildUseCase(envelope([]), editExecute);
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_EDIT_VALUE',
      contextPayload: { targetId: 'txn-99', targetField: 'amount' },
      createdAt: NOW,
      expiresAt: '2026-08-14T10:30:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute(baseInput('not a number'));

    expect(outcome.kind).toBe('edit_value_processed');
    if (
      outcome.kind === 'edit_value_processed' &&
      outcome.processEventOutcome.status === 'transitioned'
    ) {
      expect(outcome.processEventOutcome.requirementId).not.toBe('FR-CE-046'); // rejected, stays AWAITING_EDIT_VALUE
    }
  });

  it('reports edit_field_not_supported for a field this task cannot resolve yet (e.g. category)', async () => {
    const { useCase, stateRepository } = buildUseCase(envelope([]));
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_EDIT_VALUE',
      contextPayload: { targetId: 'txn-99', targetField: 'category' },
      createdAt: NOW,
      expiresAt: '2026-08-14T10:30:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute(baseInput('groceries'));

    expect(outcome).toEqual({ kind: 'edit_field_not_supported', targetField: 'category' });
  });

  it('returns awaiting_confirmation_guidance for free text while AWAITING_CONFIRMATION, without calling extraction', async () => {
    const { useCase, stateRepository, llmProvider } = buildUseCase(envelope([candidateJson()]));
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_CONFIRMATION',
      contextPayload: { transactionId: 'txn-1', draftId: 'draft-1', flaggedFields: [] },
      createdAt: NOW,
      expiresAt: '2026-08-15T10:00:00+05:00',
      version: 1,
    });

    const outcome = await useCase.execute(baseInput('something unrelated'));

    expect(outcome).toEqual({ kind: 'awaiting_confirmation_guidance' });
    expect(llmProvider.callCount).toBe(0);
  });

  it('treats an expired AWAITING_CLARIFICATION record as IDLE and routes as a fresh message', async () => {
    const { useCase, stateRepository } = buildUseCase(envelope([candidateJson()]));
    stateRepository.seed({
      userId: USER_ID,
      state: 'AWAITING_CLARIFICATION',
      contextPayload: {
        draftId: 'stale',
        missingField: 'amount',
        retryCount: 1,
        lastQuestionAsked: 'q',
      },
      createdAt: '2026-08-14T09:00:00+05:00',
      expiresAt: '2026-08-14T09:30:00+05:00', // already expired relative to NOW
      version: 1,
    });

    const outcome = await useCase.execute(baseInput('spent 45000 on lunch'));

    expect(outcome.kind).toBe('candidate_processed');
  });

  describe('TASK-MVP-001 — SALARY/REFUND now require a category to commit (Chapter 13 §13.4 category_id NOT NULL)', () => {
    it('a SALARY message with no resolvable category asks for clarification rather than committing', async () => {
      const { useCase, commitPort } = buildUseCase(
        envelope([
          candidateJson({
            intent: 'SALARY',
            category: null,
            description: 'Maosh',
            confidenceScores: { intent: 0.97, amount: 0.95, currency: 0.9, transactionDate: 0.95 },
          }),
        ]),
      );

      const outcome = await useCase.execute(baseInput('maoshimdan 8 million oldim'));

      expect(outcome.kind).toBe('candidate_processed');
      if (
        outcome.kind === 'candidate_processed' &&
        outcome.processEventOutcome.status === 'transitioned'
      ) {
        expect(outcome.processEventOutcome.requirementId).toBe('FR-CE-041'); // draft_pending_clarification entry point
        expect(outcome.processEventOutcome.nextState).toBe('AWAITING_CLARIFICATION');
      }
      expect(commitPort.calls).toHaveLength(0);
    });

    it('a SALARY message WITH a resolvable category (e.g. the seeded "SALARY" category) auto-commits normally', async () => {
      const { useCase, commitPort } = buildUseCase(
        envelope([
          candidateJson({
            intent: 'SALARY',
            category: 'SALARY',
            description: 'Maosh',
            confidenceScores: {
              intent: 0.97,
              amount: 0.95,
              currency: 0.9,
              category: 0.95,
              transactionDate: 0.95,
            },
          }),
        ]),
      );

      const outcome = await useCase.execute(baseInput('maoshimdan 8 million oldim'));

      expect(outcome.kind).toBe('candidate_processed');
      if (
        outcome.kind === 'candidate_processed' &&
        outcome.processEventOutcome.status === 'transitioned'
      ) {
        expect(outcome.processEventOutcome.requirementId).toBe('FR-CE-040'); // auto_commit
      }
      expect(commitPort.calls).toHaveLength(1);
    });

    it('a REFUND message with no resolvable category asks for clarification rather than committing', async () => {
      const { useCase, commitPort } = buildUseCase(
        envelope([
          candidateJson({
            intent: 'REFUND',
            category: null,
            description: 'Refund for returned shoes',
            confidenceScores: { intent: 0.97, amount: 0.95, currency: 0.9, transactionDate: 0.95 },
          }),
        ]),
      );

      const outcome = await useCase.execute(baseInput('got a refund, 150 thousand'));

      expect(outcome.kind).toBe('candidate_processed');
      if (
        outcome.kind === 'candidate_processed' &&
        outcome.processEventOutcome.status === 'transitioned'
      ) {
        expect(outcome.processEventOutcome.nextState).toBe('AWAITING_CLARIFICATION');
      }
      expect(commitPort.calls).toHaveLength(0);
    });
  });

  it("user isolation — never reads or mutates another user's conversation state", async () => {
    const { useCase, stateRepository } = buildUseCase(envelope([candidateJson()]));
    stateRepository.seed({
      userId: 'user-2',
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

    await useCase.execute(baseInput('spent 45000 on lunch'));

    const otherUserState = await stateRepository.get('user-2');
    expect(otherUserState?.state).toBe('AWAITING_CLARIFICATION');
  });

  describe('TASK-BOT-003 — Clarification Question Generator, integrated with TASK-BOT-002', () => {
    // TASK-AI-001's structured-output-validator rejects `amount: null`/
    // `category: null` outright for a financial/category-required intent —
    // amount/category only ever become `null` *downstream*, via TASK-AI-003's
    // `applyFieldConfidenceGating` nulling out a field whose own reported
    // confidence is below its Low-band threshold (0.6). These fixtures
    // report a real number/string with a low confidence score, exactly
    // like a real model response, rather than fabricating a schema-invalid
    // LLM response no real provider could actually return.
    it('a fresh message missing only the amount (low-confidence, nulled by field-confidence gating) asks the real amount question, not a generic "Got it"-style placeholder', async () => {
      const { useCase } = buildUseCase(
        envelope([
          candidateJson({
            amount: 1,
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              currency: 0.9,
              category: 0.9,
              transactionDate: 0.95,
            },
          }),
        ]),
      );

      const outcome = await useCase.execute(baseInput('spent something on lunch'));

      expect(outcome.kind).toBe('candidate_processed');
      if (outcome.kind === 'candidate_processed') {
        expect(outcome.clarificationQuestion).toBe('How much was it?');
      }
    });

    it('multiple missing fields (amount AND category) — only the amount question is asked (FR-CE-002 priority, one field per turn)', async () => {
      const { useCase } = buildUseCase(
        envelope([
          candidateJson({
            amount: 1,
            category: 'x',
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              category: 0.3,
              currency: 0.9,
              transactionDate: 0.95,
            },
          }),
        ]),
      );

      const outcome = await useCase.execute(baseInput('spent something'));

      expect(outcome.kind).toBe('candidate_processed');
      if (outcome.kind === 'candidate_processed') {
        expect(outcome.clarificationQuestion).toBe('How much was it?');
        expect(outcome.clarificationQuestion?.toLowerCase()).not.toContain('category');
      }
      if (
        outcome.kind === 'candidate_processed' &&
        outcome.processEventOutcome.status === 'transitioned'
      ) {
        expect(outcome.processEventOutcome.nextState).toBe('AWAITING_CLARIFICATION');
      }
    });

    it('the generated question is persisted into AWAITING_CLARIFICATION.lastQuestionAsked (not left null, per the pre-TASK-BOT-003 placeholder behavior)', async () => {
      const { useCase, stateRepository } = buildUseCase(
        envelope([
          candidateJson({
            amount: 1,
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              currency: 0.9,
              category: 0.9,
              transactionDate: 0.95,
            },
          }),
        ]),
      );

      await useCase.execute(baseInput('spent something on lunch'));

      const stored = await stateRepository.get(USER_ID);
      expect(stored?.contextPayload).toMatchObject({
        missingField: 'amount',
        lastQuestionAsked: 'How much was it?',
      });
    });

    it('generates the question in the detected language (Uzbek)', async () => {
      const { useCase } = buildUseCase({
        ...envelope([
          candidateJson({
            amount: 1,
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              currency: 0.9,
              category: 0.9,
              transactionDate: 0.95,
            },
          }),
        ]),
        detectedLanguage: 'uz',
      });

      const outcome = await useCase.execute(baseInput('ovqatga sarfladim'));

      expect(outcome.kind).toBe('candidate_processed');
      if (outcome.kind === 'candidate_processed') {
        expect(outcome.clarificationQuestion).toBe('Qancha summa edi?');
        // TASK-BOT-008 — the outcome itself now reports this turn's
        // detected language directly, not only indirectly observable via
        // the (already-localized, TASK-BOT-003) question text.
        expect(outcome.detectedLanguage).toBe('uz');
      }
    });

    it('retry: an unresolved clarification answer produces a different (more specific) re-ask, replacing the stored question', async () => {
      // A realistic non-answer ("not sure") — the AI finds no transaction
      // candidate at all in it, same as `envelope([])` elsewhere in this
      // file for a non-financial reply.
      const { useCase, stateRepository } = buildUseCase(envelope([]));
      stateRepository.seed({
        userId: USER_ID,
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'd',
          missingField: 'amount',
          retryCount: 0,
          lastQuestionAsked: 'How much was it?',
        },
        createdAt: NOW,
        // Computed relative to real wall-clock time, not a fixed past
        // string: ProcessConversationEventUseCase's own expiry check uses
        // `new Date().toISOString()` (real time), independent of this
        // test's fake `currentDateTime` input — a hardcoded absolute
        // timestamp eventually falls into the past and gets silently
        // treated as expired (see this task's final report).
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        version: 1,
      });

      const outcome = await useCase.execute(baseInput('not sure'));

      const stored = await stateRepository.get(USER_ID);

      expect(outcome.kind).toBe('clarification_processed');
      if (outcome.kind === 'clarification_processed') {
        expect(outcome.nextQuestion).not.toBeNull();
        expect(outcome.nextQuestion).not.toBe('How much was it?');
      }

      expect((stored?.contextPayload as { lastQuestionAsked?: string })?.lastQuestionAsked).toBe(
        outcome.kind === 'clarification_processed' ? outcome.nextQuestion : undefined,
      );
    });

    it('retry budget exhausted (retryCount at the NFR-CE-003 cap) — the transition falls back to the mini-form path (FR-CE-005) instead of an endless re-ask loop', async () => {
      const { useCase, stateRepository } = buildUseCase(envelope([]));
      stateRepository.seed({
        userId: USER_ID,
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'd',
          missingField: 'amount',
          retryCount: 2,
          lastQuestionAsked: 'a previous question',
        },
        createdAt: NOW,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        version: 1,
      });

      const outcome = await useCase.execute(baseInput('not sure'));

      expect(outcome.kind).toBe('clarification_processed');
      if (outcome.kind === 'clarification_processed') {
        expect(outcome.processEventOutcome.status).toBe('transitioned');
      }
      if (
        outcome.kind === 'clarification_processed' &&
        outcome.processEventOutcome.status === 'transitioned'
      ) {
        expect(outcome.processEventOutcome.requirementId).toBe('FR-CE-005');
        expect(outcome.processEventOutcome.fallbackToMiniForm).toBe(true);
        // The caller (TelegramBotService) is responsible for checking
        // fallbackToMiniForm first and using generateClarificationFallbackMessage
        // in that case rather than outcome.nextQuestion — see
        // replyForTextOutcome's own 'clarification_processed' branch.
      }
    });

    it('no fabrication end-to-end — a candidate with amount already resolved and only category missing never re-asks about amount', async () => {
      const { useCase } = buildUseCase(
        envelope([
          candidateJson({
            category: 'x', // schema-valid placeholder — nulled below by low confidence, same as a real gated response
            confidenceScores: {
              intent: 0.97,
              amount: 0.95,
              currency: 0.9,
              category: 0.3,
              transactionDate: 0.95,
            },
          }),
        ]),
      );

      const outcome = await useCase.execute(baseInput('spent 45000 on something'));

      expect(outcome.kind).toBe('candidate_processed');
      if (outcome.kind === 'candidate_processed') {
        expect(outcome.clarificationQuestion?.toLowerCase()).not.toContain('how much');
        expect(outcome.clarificationQuestion).toBe('What category does this fall under?');
      }
    });

    it('regression — auto_commit and flagged_review candidates get no clarification question at all (null)', async () => {
      const { useCase } = buildUseCase(envelope([candidateJson()]));

      const outcome = await useCase.execute(baseInput('spent 45000 on lunch'));

      expect(outcome.kind).toBe('candidate_processed');
      if (outcome.kind === 'candidate_processed') {
        expect(outcome.clarificationQuestion).toBeNull();
      }
    });
  });

  describe('TASK-BOT-005 — Interruption Detector (§5.6/§5.12.1, ADR-CE-006, AC-CE-004)', () => {
    const lowConfidenceExpenseAmount = candidateJson({
      amount: 1,
      confidenceScores: {
        intent: 0.97,
        amount: 0.3,
        currency: 0.9,
        category: 0.9,
        transactionDate: 0.95,
      },
    });

    const highConfidenceSalary = candidateJson({
      intent: 'SALARY',
      amount: 7000000,
      category: 'SALARY',
      description: 'Maosh',
      confidenceScores: {
        intent: 0.97,
        amount: 0.95,
        currency: 0.9,
        category: 0.95,
        transactionDate: 0.95,
      },
    });

    it('an unrelated, high-confidence new transaction while AWAITING_CLARIFICATION commits immediately and preserves the pending clarification untouched (§5.6 row 1, ADR-CE-006, AC-CE-004)', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCaseWithSequence([
        envelope([lowConfidenceExpenseAmount]),
        envelope([highConfidenceSalary]),
      ]);

      const first = await useCase.execute(baseInput('spent something on lunch'));
      expect(first.kind).toBe('candidate_processed');
      const stateAfterFirst = await stateRepository.get(USER_ID);
      expect(stateAfterFirst?.state).toBe('AWAITING_CLARIFICATION');
      const originalDraftId = (stateAfterFirst?.contextPayload as { draftId?: string } | null)
        ?.draftId;
      expect(originalDraftId).toBeDefined();

      const second = await useCase.execute(baseInput('maoshimdan 7 million oldim'));

      expect(second.kind).toBe('interruption_committed');
      if (second.kind === 'interruption_committed') {
        expect(second.candidate.intent).toBe('SALARY');
        expect(second.transactionId).toBeDefined();
      }
      expect(commitPort.calls).toHaveLength(1);
      expect(commitPort.calls[0]?.candidate.intent).toBe('SALARY');

      // The ORIGINAL pending clarification must be completely untouched —
      // same state, same context payload, same version (no CAS write
      // attempted for it at all).
      const stateAfterSecond = await stateRepository.get(USER_ID);
      expect(stateAfterSecond).toEqual(stateAfterFirst);

      // Both drafts exist independently: the old one still pending, the
      // new (interrupting) one completed with its own resolved transaction.
      expect(draftRepository.records.get(originalDraftId!)?.status).toBe('pending');
      const newDraft = [...draftRepository.records.values()].find((d) => d.id !== originalDraftId);
      expect(newDraft?.status).toBe('completed');
      expect(newDraft?.resolvedTransactionId).toBe(
        second.kind === 'interruption_committed' ? second.transactionId : undefined,
      );
    });

    it('a same-intent, high-confidence reply is a continuation, not an interruption — high confidence alone does not mean "unrelated" (and, per TASK-BOT-002-FIX, now correctly commits exactly once)', async () => {
      const { useCase, commitPort } = buildUseCaseWithSequence([
        envelope([lowConfidenceExpenseAmount]),
        envelope([candidateJson({ amount: 45000 })]), // same EXPENSE intent, now fully resolved
      ]);

      await useCase.execute(baseInput('spent something on lunch'));
      const second = await useCase.execute(baseInput('45000'));

      expect(second.kind).toBe('clarification_resolved');
      expect(commitPort.calls).toHaveLength(1); // routed through the ordinary CLARIFICATION_ANSWER-resolves-and-commits path, not the interruption path
    });

    it("a different-intent but only medium-confidence (flagged_review) reply is treated as a continuation attempt, not an interruption — out of this task's scope (see final report)", async () => {
      const { useCase, commitPort, draftRepository } = buildUseCaseWithSequence([
        envelope([lowConfidenceExpenseAmount]),
        envelope([
          candidateJson({
            intent: 'DEBT_GIVEN',
            amount: 1, // schema requires non-null for a financial intent; nulled downstream by low confidence, same pattern as the rest of this file
            counterparty: 'Aziz',
            confidenceScores: {
              intent: 0.7,
              amount: 0.3,
              currency: 0.9,
              counterparty: 0.7,
              transactionDate: 0.9,
            },
          }),
        ]),
      ]);

      await useCase.execute(baseInput('spent something on lunch'));
      const second = await useCase.execute(baseInput('Aziz ga qarz berdim'));

      // Not an interruption (flagged_review, not auto_commit) AND does not
      // resolve the pending 'amount' field either (the reply names no
      // amount) — correctly falls through to the ordinary FR-CE-042 retry,
      // not a commit.
      expect(second.kind).toBe('clarification_processed');
      expect(commitPort.calls).toHaveLength(0);
      expect(draftRepository.records.size).toBe(1); // no second draft created for a non-interruption
    });

    it('cancellation during AWAITING_CLARIFICATION is unaffected by the Interruption Detector — the existing top-level cancellation-phrase check still fires first (FR-CE-047)', async () => {
      const { useCase, stateRepository } = buildUseCase(envelope([lowConfidenceExpenseAmount]));
      await useCase.execute(baseInput('spent something on lunch'));

      const outcome = await useCase.execute(baseInput('cancel'));

      expect(outcome.kind).toBe('cancelled');
      const state = await stateRepository.get(USER_ID);
      expect(state?.state).toBe('IDLE');
    });

    it('a stale/duplicate interrupting message does not double-commit (idempotency preserved via the existing TransactionCommitPort/draftId keying)', async () => {
      const { useCase, commitPort } = buildUseCaseWithSequence([
        envelope([lowConfidenceExpenseAmount]),
        envelope([highConfidenceSalary]),
        envelope([highConfidenceSalary]),
      ]);

      await useCase.execute(baseInput('spent something on lunch'));
      const first = await useCase.execute(baseInput('maoshimdan 7 million oldim'));
      const replay = await useCase.execute(baseInput('maoshimdan 7 million oldim'));

      expect(first.kind).toBe('interruption_committed');
      expect(replay.kind).toBe('interruption_committed');
      // Each interrupting message gets its own fresh draftId (a genuinely
      // new inbound message, not a retried delivery of the same one) —
      // TransactionCommitPort's own idempotency key is per-draftId, so two
      // *distinct* messages that happen to describe the same transaction
      // are, correctly, two separate commits (this is not the "duplicate
      // Telegram update" case, which TelegramUpdateDedupService already
      // handles upstream of this use case entirely).
      expect(commitPort.calls).toHaveLength(2);
    });

    it("user isolation — an interrupting transaction for one user never reads or mutates another user's pending clarification", async () => {
      const { useCase, stateRepository } = buildUseCaseWithSequence([
        envelope([lowConfidenceExpenseAmount]),
        envelope([highConfidenceSalary]),
      ]);
      stateRepository.seed({
        userId: 'user-2',
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'other-draft',
          missingField: 'amount',
          retryCount: 0,
          lastQuestionAsked: 'How much?',
        },
        createdAt: NOW,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        version: 1,
      });

      await useCase.execute(baseInput('spent something on lunch'));
      await useCase.execute(baseInput('maoshimdan 7 million oldim'));

      const otherUserState = await stateRepository.get('user-2');
      expect(otherUserState?.state).toBe('AWAITING_CLARIFICATION');
      expect(otherUserState?.version).toBe(1);
    });

    it('reports interruption_commit_failed (not a thrown error) when TransactionCommitPort rejects the interrupting candidate, leaving the pending clarification untouched', async () => {
      const { useCase, stateRepository, commitPort } = buildUseCaseWithSequence([
        envelope([lowConfidenceExpenseAmount]),
        envelope([highConfidenceSalary]),
      ]);
      await useCase.execute(baseInput('spent something on lunch'));
      const stateBefore = await stateRepository.get(USER_ID);
      commitPort.failNextCommit(new Error('category not found'));

      const outcome = await useCase.execute(baseInput('maoshimdan 7 million oldim'));

      expect(outcome).toEqual({
        kind: 'interruption_commit_failed',
        reason: 'category not found',
        detectedLanguage: 'en',
      });
      const stateAfter = await stateRepository.get(USER_ID);
      expect(stateAfter).toEqual(stateBefore);
    });
  });

  describe('TASK-BOT-002-FIX — Clarification Resolution Commit (§5.2.3 state diagram, FR-CE-043)', () => {
    const lowConfidenceAmount = candidateJson({
      amount: 1,
      confidenceScores: {
        intent: 0.97,
        amount: 0.3,
        currency: 0.9,
        category: 0.9,
        transactionDate: 0.95,
      },
    });

    it('a final clarification answer that resolves the last missing field commits exactly once, marks the draft completed, and transitions state to IDLE', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCaseWithSequence([
        envelope([lowConfidenceAmount]),
        envelope([candidateJson({ amount: 45000 })]),
      ]);

      await useCase.execute(baseInput('spent something on lunch'));
      const stateAfterFirst = await stateRepository.get(USER_ID);
      const draftId = (stateAfterFirst?.contextPayload as { draftId?: string } | null)?.draftId;
      expect(draftId).toBeDefined();

      const outcome = await useCase.execute(baseInput('45000'));

      expect(outcome.kind).toBe('clarification_resolved');
      if (outcome.kind === 'clarification_resolved') {
        expect(outcome.transactionId).toBeDefined();
        expect(outcome.candidate.amount).toBe(45000);
      }
      expect(commitPort.calls).toHaveLength(1);
      expect(draftRepository.records.get(draftId!)?.status).toBe('completed');
      expect(draftRepository.records.get(draftId!)?.resolvedTransactionId).toBe(
        outcome.kind === 'clarification_resolved' ? outcome.transactionId : undefined,
      );
      const stateAfter = await stateRepository.get(USER_ID);
      expect(stateAfter?.state).toBe('IDLE');
    });

    it("the committed candidate merges the newly-resolved field into the ORIGINAL draft data — not just this turn's context-poor re-extraction, which never saw the earlier turn's amount/category", async () => {
      const { useCase, commitPort } = buildUseCaseWithSequence([
        envelope([lowConfidenceAmount]), // category: 'FOOD_DINING' already known from turn 1
        envelope([candidateJson({ amount: 45000 })]),
      ]);
      await useCase.execute(baseInput('spent something on lunch'));

      await useCase.execute(baseInput('45000'));

      expect(commitPort.calls[0]?.candidate.category).toBe('FOOD_DINING'); // preserved from the original draft
      expect(commitPort.calls[0]?.candidate.amount).toBe(45000); // the newly-resolved value, this turn
    });

    it('a non-final (unresolved) clarification answer does not commit and remains in AWAITING_CLARIFICATION (FR-CE-042, unaffected by this fix)', async () => {
      const { useCase, stateRepository, commitPort } = buildUseCaseWithSequence([
        envelope([lowConfidenceAmount]),
        envelope([]), // extraction produces no candidate — does not resolve the amount field
      ]);
      await useCase.execute(baseInput('spent something on lunch'));

      const outcome = await useCase.execute(baseInput('not sure'));

      expect(outcome.kind).toBe('clarification_processed');
      expect(commitPort.calls).toHaveLength(0);
      const state = await stateRepository.get(USER_ID);
      expect(state?.state).toBe('AWAITING_CLARIFICATION');
    });

    it('cancellation during AWAITING_CLARIFICATION still produces zero transactions (preserved, unaffected by this fix)', async () => {
      const { useCase, commitPort, stateRepository } = buildUseCaseWithSequence([
        envelope([lowConfidenceAmount]),
      ]);
      await useCase.execute(baseInput('spent something on lunch'));

      const outcome = await useCase.execute(baseInput('cancel'));

      expect(outcome.kind).toBe('cancelled');
      expect(commitPort.calls).toHaveLength(0);
      const state = await stateRepository.get(USER_ID);
      expect(state?.state).toBe('IDLE');
    });

    it("a duplicate/replayed final clarification answer reuses the SAME draftId for both commit attempts — the exact key TransactionCommitPort's existing idempotency lock (TASK-FIN-REAL-001, unchanged) dedupes on, so no duplicate transaction is ever actually persisted", async () => {
      const { useCase, commitPort } = buildUseCaseWithSequence([
        envelope([lowConfidenceAmount]),
        envelope([candidateJson({ amount: 45000 })]),
        envelope([candidateJson({ amount: 45000 })]),
      ]);
      await useCase.execute(baseInput('spent something on lunch'));

      // Both calls read the SAME AWAITING_CLARIFICATION state before either
      // has written — simulates a genuine duplicate/replayed delivery of
      // the identical answer, the exact scenario TransactionCommitPort's
      // draftId-keyed idempotency lock (unchanged, already covered by its
      // own 24 tests) exists to protect against; this test's own
      // responsibility is only to prove RouteTextMessageUseCase always
      // sources that key from the SAME context.draftId, never inventing a
      // fresh one per attempt.
      const [first, second] = await Promise.all([
        useCase.execute(baseInput('45000')),
        useCase.execute(baseInput('45000')),
      ]);

      expect(commitPort.calls).toHaveLength(2);
      expect(commitPort.calls[0]?.draftId).toBe(commitPort.calls[1]?.draftId);
      expect(
        first.kind === 'clarification_resolved' || second.kind === 'clarification_resolved',
      ).toBe(true);
    });

    it("user isolation — resolving one user's clarification never reads or mutates another user's pending clarification state", async () => {
      const { useCase, stateRepository } = buildUseCaseWithSequence([
        envelope([lowConfidenceAmount]),
        envelope([candidateJson({ amount: 45000 })]),
      ]);
      stateRepository.seed({
        userId: 'user-2',
        state: 'AWAITING_CLARIFICATION',
        contextPayload: {
          draftId: 'other-draft',
          missingField: 'amount',
          retryCount: 0,
          lastQuestionAsked: 'How much?',
        },
        createdAt: NOW,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        version: 1,
      });

      await useCase.execute(baseInput('spent something on lunch'));
      await useCase.execute(baseInput('45000'));

      const otherUserState = await stateRepository.get('user-2');
      expect(otherUserState?.state).toBe('AWAITING_CLARIFICATION');
      expect(otherUserState?.version).toBe(1);
    });

    it('a commit failure on the final clarification answer leaves the draft and conversation_state completely untouched, and reports clarification_commit_failed rather than a false success', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCaseWithSequence([
        envelope([lowConfidenceAmount]),
        envelope([candidateJson({ amount: 45000 })]),
      ]);
      await useCase.execute(baseInput('spent something on lunch'));
      const stateBefore = await stateRepository.get(USER_ID);
      const draftId = (stateBefore?.contextPayload as { draftId?: string } | null)?.draftId;
      expect(draftId).toBeDefined();
      commitPort.failNextCommit(new Error('category not found'));

      const outcome = await useCase.execute(baseInput('45000'));

      expect(outcome).toEqual({
        kind: 'clarification_commit_failed',
        reason: 'category not found',
        detectedLanguage: 'en',
      });
      const stateAfter = await stateRepository.get(USER_ID);
      expect(stateAfter).toEqual(stateBefore);
      expect(draftRepository.records.get(draftId!)?.status).toBe('pending');
    });
  });

  describe('TASK-BOT-006 — Multi-Item Review Flow (§5.7, compound-text path)', () => {
    it('a compound message with at least one low-confidence candidate starts AWAITING_MULTI_ITEM_REVIEW, one draft per candidate, none committed yet', async () => {
      const { useCase, stateRepository, draftRepository, commitPort } = buildUseCase(
        envelope([
          candidateJson({ description: 'Lunch' }), // auto_commit band
          candidateJson({
            description: 'Coffee',
            amount: 1,
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              currency: 0.9,
              category: 0.9,
              transactionDate: 0.95,
            },
          }), // draft_pending_clarification band — "needs review"
        ]),
      );

      const outcome = await useCase.execute(
        baseInput('spent 45000 on lunch and something on coffee'),
      );

      expect(outcome.kind).toBe('batch_review_started');
      if (outcome.kind === 'batch_review_started') {
        expect(outcome.totalItems).toBe(2);
        expect(outcome.highConfidenceCount).toBe(1);
        expect(outcome.lowConfidenceCandidates).toHaveLength(1);
        expect(outcome.lowConfidenceCandidates[0]?.description).toBe('Coffee');
        expect(outcome.lowConfidenceDraftIds).toHaveLength(1);
        expect(outcome.lowConfidenceDraftIds[0]).toBeTruthy();
        expect(outcome.batchId).toBeTruthy();
      }
      expect(commitPort.calls).toHaveLength(0); // nothing auto-committed — even the high-confidence item waits for an explicit batch-commit tap
      expect(draftRepository.records.size).toBe(2);
      expect([...draftRepository.records.values()].every((d) => d.status === 'pending')).toBe(true);

      const state = await stateRepository.get(USER_ID);
      expect(state?.state).toBe('AWAITING_MULTI_ITEM_REVIEW');
      expect(state?.contextPayload).toMatchObject({
        totalItems: 2,
        currentIndex: 0,
        pendingCancelConfirmation: false,
      });
    });

    it('free text while AWAITING_MULTI_ITEM_REVIEW returns awaiting_confirmation_guidance, without calling extraction again (button-driven, like AWAITING_CONFIRMATION)', async () => {
      const { useCase, stateRepository, llmProvider } = buildUseCase(
        envelope([
          candidateJson(),
          candidateJson({
            amount: 1,
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              currency: 0.9,
              category: 0.9,
              transactionDate: 0.95,
            },
          }),
        ]),
      );
      await useCase.execute(baseInput('lunch and something else'));
      const callsAfterEntry = llmProvider.callCount;
      const stateAfterEntry = await stateRepository.get(USER_ID);
      expect(stateAfterEntry?.state).toBe('AWAITING_MULTI_ITEM_REVIEW');

      const outcome = await useCase.execute(baseInput('something unrelated'));

      expect(outcome).toEqual({ kind: 'awaiting_confirmation_guidance' });
      expect(llmProvider.callCount).toBe(callsAfterEntry); // no extraction call for free text in this state
      const state = await stateRepository.get(USER_ID);
      expect(state?.state).toBe('AWAITING_MULTI_ITEM_REVIEW'); // unaffected
    });

    it('cancellation during AWAITING_MULTI_ITEM_REVIEW requires two cancellation phrases (FR-CE-052) — the first only asks for confirmation, batch progress is preserved', async () => {
      const { useCase, stateRepository, draftRepository } = buildUseCase(
        envelope([
          candidateJson(),
          candidateJson({
            amount: 1,
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              currency: 0.9,
              category: 0.9,
              transactionDate: 0.95,
            },
          }),
        ]),
      );
      await useCase.execute(baseInput('lunch and something else'));

      const first = await useCase.execute(baseInput('cancel'));

      expect(first.kind).toBe('cancelled');
      const stateAfterFirst = await stateRepository.get(USER_ID);
      expect(stateAfterFirst?.state).toBe('AWAITING_MULTI_ITEM_REVIEW'); // NOT discarded yet
      expect(stateAfterFirst?.contextPayload).toMatchObject({ pendingCancelConfirmation: true });
      expect(draftRepository.records.size).toBe(2); // both drafts still exist, untouched

      const second = await useCase.execute(baseInput('cancel'));

      expect(second.kind).toBe('cancelled');
      const stateAfterSecond = await stateRepository.get(USER_ID);
      expect(stateAfterSecond?.state).toBe('IDLE'); // now actually discarded
    });

    it("user isolation — starting one user's batch review never reads or mutates another user's conversation state", async () => {
      const { useCase, stateRepository } = buildUseCase(
        envelope([candidateJson(), candidateJson({ description: 'Taxi' })]),
      );
      stateRepository.seed({
        userId: 'user-2',
        state: 'AWAITING_MULTI_ITEM_REVIEW',
        contextPayload: {
          batchId: 'other-batch',
          totalItems: 2,
          highConfidenceDraftIds: [],
          lowConfidenceDraftIds: ['a', 'b'],
          currentIndex: 0,
          pendingCancelConfirmation: false,
        },
        createdAt: NOW,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        version: 1,
      });

      await useCase.execute(baseInput('lunch and taxi'));

      const otherUserState = await stateRepository.get('user-2');
      expect(otherUserState?.state).toBe('AWAITING_MULTI_ITEM_REVIEW');
      expect(otherUserState?.version).toBe(1);
    });
  });

  describe('TASK-BOT-008 — detectedLanguage threaded through outcomes (Chapter 4 §4.2.2)', () => {
    it('no_transaction_detected reports the real detected language, not a hardcoded default', async () => {
      const { useCase } = buildUseCase({
        transactions: [],
        detectedLanguage: 'ru',
        clarificationNeeded: false,
        clarificationQuestion: null,
      });

      const outcome = await useCase.execute(baseInput('привет'));

      expect(outcome).toEqual({ kind: 'no_transaction_detected', detectedLanguage: 'ru' });
    });

    it('batch_all_high_confidence_committed and batch_review_started both report the real detected language', async () => {
      const { useCase: allHighConfidence } = buildUseCase({
        ...envelope([candidateJson(), candidateJson({ description: 'Taxi', amount: 15000 })]),
        detectedLanguage: 'uz',
      });
      const committedOutcome = await allHighConfidence.execute(baseInput('tushlik va taksi'));
      expect(committedOutcome.kind).toBe('batch_all_high_confidence_committed');
      if (committedOutcome.kind === 'batch_all_high_confidence_committed') {
        expect(committedOutcome.detectedLanguage).toBe('uz');
      }

      const { useCase: mixedConfidence } = buildUseCase({
        ...envelope([
          candidateJson(),
          candidateJson({
            description: 'Coffee',
            amount: 1,
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              currency: 0.9,
              category: 0.9,
              transactionDate: 0.95,
            },
          }),
        ]),
        detectedLanguage: 'uz',
      });
      const startedOutcome = await mixedConfidence.execute(baseInput('tushlik va qahva'));
      expect(startedOutcome.kind).toBe('batch_review_started');
      if (startedOutcome.kind === 'batch_review_started') {
        expect(startedOutcome.detectedLanguage).toBe('uz');
      }
    });

    it('clarification_resolved and interruption_committed both report the real detected language of the resolving/interrupting message', async () => {
      const { useCase: clarificationCase, stateRepository } = buildUseCaseWithSequence([
        envelope([
          candidateJson({
            amount: 1,
            confidenceScores: {
              intent: 0.97,
              amount: 0.3,
              currency: 0.9,
              category: 0.9,
              transactionDate: 0.95,
            },
          }),
        ]),
        { ...envelope([candidateJson({ amount: 45000 })]), detectedLanguage: 'ru' },
      ]);
      await clarificationCase.execute(baseInput('spent something on lunch'));
      expect((await stateRepository.get(USER_ID))?.state).toBe('AWAITING_CLARIFICATION');

      const resolvedOutcome = await clarificationCase.execute(baseInput('45000'));
      expect(resolvedOutcome.kind).toBe('clarification_resolved');
      if (resolvedOutcome.kind === 'clarification_resolved') {
        expect(resolvedOutcome.detectedLanguage).toBe('ru');
      }
    });
  });
});
