import { describe, expect, it } from 'vitest';

import { evaluateConversationTransition } from './evaluate-conversation-transition';
import type { TransitionOutcome } from './evaluate-conversation-transition';
import type {
  AwaitingClarificationContext,
  AwaitingConfirmationContext,
  AwaitingEditValueContext,
} from './conversation-state';
import type { CandidateResolvedEvent, ConversationEvent } from './conversation-events';
import type { TransactionExtractionCandidate } from '../ai-extraction/transaction-extraction-schema';

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
      intent: 0.98,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
    ...overrides,
  };
}

function candidateResolvedEvent(
  overrides: Partial<CandidateResolvedEvent> = {},
): CandidateResolvedEvent {
  return {
    type: 'CANDIDATE_RESOLVED',
    classification: 'auto_commit',
    candidate: candidate(),
    missingField: null,
    clarificationQuestion: null,
    draftId: 'draft-1',
    originalText: 'spent 45000 on lunch',
    sourceType: 'text',
    ...overrides,
  };
}

function expectAllowed(
  outcome: TransitionOutcome,
): asserts outcome is TransitionOutcome & { allowed: true } {
  expect(outcome.allowed).toBe(true);
}

function expectRejected(
  outcome: TransitionOutcome,
): asserts outcome is TransitionOutcome & { allowed: false } {
  expect(outcome.allowed).toBe(false);
}

describe('evaluateConversationTransition — full §5.13.2 guard-table coverage', () => {
  describe('FR-CE-040: IDLE -> IDLE (direct commit)', () => {
    it('guard-satisfied: auto_commit classification commits and stays IDLE', () => {
      const outcome = evaluateConversationTransition(
        'IDLE',
        null,
        candidateResolvedEvent({ classification: 'auto_commit' }),
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-040');
      expect(outcome.nextState).toBe('IDLE');
      expect(outcome.commitRequested).toBe(true);
      expect(outcome.flaggedFieldsIfCommitting).toEqual([]);
    });

    it('guard-unsatisfied: a flagged_review classification does NOT take the FR-CE-040 branch', () => {
      const outcome = evaluateConversationTransition(
        'IDLE',
        null,
        candidateResolvedEvent({ classification: 'flagged_review' }),
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).not.toBe('FR-CE-040');
    });
  });

  describe('FR-CE-041: IDLE -> AWAITING_CLARIFICATION', () => {
    it('guard-satisfied: draft_pending_clarification classification enters clarification with the supplied missing field', () => {
      const outcome = evaluateConversationTransition(
        'IDLE',
        null,
        candidateResolvedEvent({
          classification: 'draft_pending_clarification',
          missingField: 'amount',
          draftId: 'draft-42',
        }),
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-041');
      expect(outcome.nextState).toBe('AWAITING_CLARIFICATION');
      expect(outcome.commitRequested).toBe(false);
      const context = outcome.nextContextPayload as AwaitingClarificationContext;
      expect(context).toEqual({
        draftId: 'draft-42',
        missingField: 'amount',
        retryCount: 0,
        lastQuestionAsked: null,
      });
    });

    it('accepts a null missingField (intent itself ambiguous, §5.3.1)', () => {
      const outcome = evaluateConversationTransition(
        'IDLE',
        null,
        candidateResolvedEvent({
          classification: 'draft_pending_clarification',
          missingField: null,
        }),
      );

      expectAllowed(outcome);
      expect((outcome.nextContextPayload as AwaitingClarificationContext).missingField).toBeNull();
    });

    it('guard-unsatisfied: an auto_commit classification does NOT take the FR-CE-041 branch', () => {
      const outcome = evaluateConversationTransition(
        'IDLE',
        null,
        candidateResolvedEvent({ classification: 'auto_commit' }),
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).not.toBe('FR-CE-041');
    });
  });

  describe('FR-CE-042: AWAITING_CLARIFICATION -> AWAITING_CLARIFICATION (retry)', () => {
    const context: AwaitingClarificationContext = {
      draftId: 'draft-1',
      missingField: 'amount',
      retryCount: 0,
      lastQuestionAsked: 'How much?',
    };

    it('guard-satisfied: still unresolved, retryCount < 2 -> re-ask, retryCount increments', () => {
      const outcome = evaluateConversationTransition('AWAITING_CLARIFICATION', context, {
        type: 'CLARIFICATION_ANSWER',
        fieldResolved: false,
        nextQuestion: 'a more specific question',
      });

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-042');
      expect(outcome.nextState).toBe('AWAITING_CLARIFICATION');
      expect((outcome.nextContextPayload as AwaitingClarificationContext).retryCount).toBe(1);
      expect((outcome.nextContextPayload as AwaitingClarificationContext).lastQuestionAsked).toBe(
        'a more specific question',
      );
      expect(outcome.fallbackToMiniForm).toBe(false);
    });

    it('guard-unsatisfied: retryCount already at the NFR-CE-003 cap (2) does NOT take the FR-CE-042 branch — falls back to mini-form (FR-CE-005) instead', () => {
      const exhausted: AwaitingClarificationContext = { ...context, retryCount: 2 };
      const outcome = evaluateConversationTransition('AWAITING_CLARIFICATION', exhausted, {
        type: 'CLARIFICATION_ANSWER',
        fieldResolved: false,
        nextQuestion: null,
      });

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-005');
      expect(outcome.nextState).toBe('AWAITING_CLARIFICATION');
      expect(outcome.fallbackToMiniForm).toBe(true);
    });
  });

  describe('FR-CE-043: AWAITING_CLARIFICATION -> IDLE', () => {
    const context: AwaitingClarificationContext = {
      draftId: 'draft-1',
      missingField: 'amount',
      retryCount: 1,
      lastQuestionAsked: 'How much?',
    };

    it('guard-satisfied: field resolved -> IDLE', () => {
      const outcome = evaluateConversationTransition('AWAITING_CLARIFICATION', context, {
        type: 'CLARIFICATION_ANSWER',
        fieldResolved: true,
        nextQuestion: null,
      });

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-043');
      expect(outcome.nextState).toBe('IDLE');
      expect(outcome.nextContextPayload).toBeNull();
    });

    it('guard-unsatisfied: field not resolved does NOT take the FR-CE-043 branch (takes FR-CE-042 instead)', () => {
      const outcome = evaluateConversationTransition('AWAITING_CLARIFICATION', context, {
        type: 'CLARIFICATION_ANSWER',
        fieldResolved: false,
        nextQuestion: 'a more specific question',
      });

      expectAllowed(outcome);
      expect(outcome.requirementId).not.toBe('FR-CE-043');
    });
  });

  describe('FR-CE-044: IDLE -> AWAITING_CONFIRMATION', () => {
    it('guard-satisfied: flagged_review classification commits with flagged fields, enters confirmation', () => {
      const outcome = evaluateConversationTransition(
        'IDLE',
        null,
        candidateResolvedEvent({
          classification: 'flagged_review',
          candidate: candidate({
            confidenceScores: {
              intent: 0.9,
              amount: 0.9,
              currency: 0.9,
              category: 0.7,
              transactionDate: 0.9,
            },
          }),
        }),
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-044');
      expect(outcome.nextState).toBe('AWAITING_CONFIRMATION');
      expect(outcome.commitRequested).toBe(true);
      expect(outcome.flaggedFieldsIfCommitting).toContain('category');
      // nextContextPayload is intentionally null here — the transactionId doesn't exist
      // until the use case actually commits; see the evaluator's own doc comment.
      expect(outcome.nextContextPayload).toBeNull();
    });

    it('guard-unsatisfied: a draft_pending_clarification classification does NOT take the FR-CE-044 branch', () => {
      const outcome = evaluateConversationTransition(
        'IDLE',
        null,
        candidateResolvedEvent({ classification: 'draft_pending_clarification' }),
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).not.toBe('FR-CE-044');
    });
  });

  describe('FR-CE-045: AWAITING_CONFIRMATION -> AWAITING_EDIT_VALUE', () => {
    const context: AwaitingConfirmationContext = {
      transactionId: 'txn-1',
      draftId: 'draft-1',
      flaggedFields: ['category'],
    };

    it('guard-satisfied: user taps Edit while AWAITING_CONFIRMATION', () => {
      const outcome = evaluateConversationTransition('AWAITING_CONFIRMATION', context, {
        type: 'EDIT_REQUESTED',
        targetField: 'category',
      });

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-045');
      expect(outcome.nextState).toBe('AWAITING_EDIT_VALUE');
      expect(outcome.nextContextPayload).toEqual({ targetId: 'txn-1', targetField: 'category' });
    });

    it('guard-unsatisfied: an edit request while IDLE is rejected, fails safely', () => {
      const outcome = evaluateConversationTransition('IDLE', null, {
        type: 'EDIT_REQUESTED',
        targetField: 'category',
      });

      expectRejected(outcome);
      expect(outcome.requirementId).toBe('FR-CE-045');
    });
  });

  describe('FR-CE-046: AWAITING_EDIT_VALUE -> IDLE', () => {
    const context: AwaitingEditValueContext = { targetId: 'txn-1', targetField: 'category' };

    it('guard-satisfied: replacement value passes validation -> IDLE', () => {
      const outcome = evaluateConversationTransition('AWAITING_EDIT_VALUE', context, {
        type: 'EDIT_VALUE_PROVIDED',
        valid: true,
      });

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-046');
      expect(outcome.nextState).toBe('IDLE');
    });

    it('guard-unsatisfied: replacement value fails validation -> rejected, no state change (fails safely)', () => {
      const outcome = evaluateConversationTransition('AWAITING_EDIT_VALUE', context, {
        type: 'EDIT_VALUE_PROVIDED',
        valid: false,
      });

      expectRejected(outcome);
      expect(outcome.requirementId).toBe('FR-CE-046');
    });
  });

  describe('FR-CE-047: any pending state -> IDLE (cancellation)', () => {
    it('guard-satisfied: cancellation from AWAITING_CLARIFICATION -> IDLE', () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_CLARIFICATION',
        { draftId: 'd', missingField: 'amount', retryCount: 0, lastQuestionAsked: null },
        { type: 'CANCELLATION' },
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-047');
      expect(outcome.nextState).toBe('IDLE');
      expect(outcome.nextContextPayload).toBeNull();
    });

    it('guard-satisfied: cancellation from AWAITING_CONFIRMATION -> IDLE', () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_CONFIRMATION',
        { transactionId: 't', draftId: 'd', flaggedFields: [] },
        { type: 'CANCELLATION' },
      );

      expectAllowed(outcome);
      expect(outcome.nextState).toBe('IDLE');
    });

    it('guard-satisfied: cancellation from AWAITING_EDIT_VALUE -> IDLE', () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_EDIT_VALUE',
        { targetId: 't', targetField: 'amount' },
        { type: 'CANCELLATION' },
      );

      expectAllowed(outcome);
      expect(outcome.nextState).toBe('IDLE');
    });

    it('guard-unsatisfied: cancellation from IDLE is rejected — nothing to cancel', () => {
      const outcome = evaluateConversationTransition('IDLE', null, { type: 'CANCELLATION' });

      expectRejected(outcome);
      expect(outcome.requirementId).toBe('FR-CE-047');
    });
  });

  describe('invalid transitions fail safely', () => {
    it('a CANDIDATE_RESOLVED event while AWAITING_CLARIFICATION is rejected, not silently accepted', () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_CLARIFICATION',
        { draftId: 'd', missingField: 'amount', retryCount: 0, lastQuestionAsked: null },
        candidateResolvedEvent(),
      );

      expectRejected(outcome);
    });

    it('a CLARIFICATION_ANSWER while IDLE is rejected', () => {
      const outcome = evaluateConversationTransition('IDLE', null, {
        type: 'CLARIFICATION_ANSWER',
        fieldResolved: true,
        nextQuestion: null,
      });

      expectRejected(outcome);
    });

    it('an EDIT_VALUE_PROVIDED while AWAITING_CONFIRMATION is rejected', () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_CONFIRMATION',
        { transactionId: 't', draftId: 'd', flaggedFields: [] },
        { type: 'EDIT_VALUE_PROVIDED', valid: true },
      );

      expectRejected(outcome);
    });

    it('never throws for any (state, event) combination — always returns a discriminated outcome', () => {
      const events: ConversationEvent[] = [
        candidateResolvedEvent(),
        { type: 'CLARIFICATION_ANSWER', fieldResolved: true, nextQuestion: null },
        { type: 'EDIT_REQUESTED', targetField: 'amount' },
        { type: 'EDIT_VALUE_PROVIDED', valid: true },
        { type: 'CANCELLATION' },
        {
          type: 'BATCH_REVIEW_STARTED',
          batchId: 'batch-1',
          totalItems: 2,
          highConfidenceDraftIds: [],
          lowConfidenceDraftIds: ['d1', 'd2'],
        },
        { type: 'BATCH_ITEM_REVIEWED' },
      ];
      const states: Array<Parameters<typeof evaluateConversationTransition>[0]> = [
        'IDLE',
        'AWAITING_CLARIFICATION',
        'AWAITING_CONFIRMATION',
        'AWAITING_EDIT_VALUE',
        'AWAITING_MULTI_ITEM_REVIEW',
      ];

      for (const state of states) {
        for (const event of events) {
          expect(() => evaluateConversationTransition(state, null, event)).not.toThrow();
        }
      }
    });
  });

  describe('TASK-BOT-006 — FR-CE-030: IDLE -> AWAITING_MULTI_ITEM_REVIEW (batch review entry)', () => {
    function batchReviewStartedEvent(
      overrides: Partial<Extract<ConversationEvent, { type: 'BATCH_REVIEW_STARTED' }>> = {},
    ): ConversationEvent {
      return {
        type: 'BATCH_REVIEW_STARTED',
        batchId: 'batch-1',
        totalItems: 3,
        highConfidenceDraftIds: ['hc-1'],
        lowConfidenceDraftIds: ['lc-1', 'lc-2'],
        ...overrides,
      };
    }

    it('guard-satisfied: starts a batch review from IDLE, index 0, no pending cancel confirmation', () => {
      const outcome = evaluateConversationTransition('IDLE', null, batchReviewStartedEvent());

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-030');
      expect(outcome.nextState).toBe('AWAITING_MULTI_ITEM_REVIEW');
      expect(outcome.nextContextPayload).toEqual({
        batchId: 'batch-1',
        totalItems: 3,
        highConfidenceDraftIds: ['hc-1'],
        lowConfidenceDraftIds: ['lc-1', 'lc-2'],
        currentIndex: 0,
        pendingCancelConfirmation: false,
      });
      expect(outcome.commitRequested).toBe(false); // batch entry never auto-commits anything itself
    });

    it('guard-unsatisfied: a batch review cannot start from a non-IDLE state', () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_CLARIFICATION',
        { draftId: 'd', missingField: 'amount', retryCount: 0, lastQuestionAsked: null },
        batchReviewStartedEvent(),
      );

      expectRejected(outcome);
    });
  });

  describe('TASK-BOT-006 — FR-CE-032/FR-CE-033: AWAITING_MULTI_ITEM_REVIEW item advance/completion', () => {
    function reviewContext(
      overrides: Partial<{
        currentIndex: number;
        lowConfidenceDraftIds: readonly string[];
        pendingCancelConfirmation: boolean;
      }> = {},
    ) {
      return {
        batchId: 'batch-1',
        totalItems: 3,
        highConfidenceDraftIds: ['hc-1'],
        lowConfidenceDraftIds: ['lc-1', 'lc-2'],
        currentIndex: 0,
        pendingCancelConfirmation: false,
        ...overrides,
      };
    }

    it('guard-satisfied: advances to the next item when more remain (FR-CE-032)', () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_MULTI_ITEM_REVIEW',
        reviewContext({ currentIndex: 0 }),
        { type: 'BATCH_ITEM_REVIEWED' },
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-032');
      expect(outcome.nextState).toBe('AWAITING_MULTI_ITEM_REVIEW');
      expect(outcome.nextContextPayload).toMatchObject({ currentIndex: 1 });
    });

    it('guard-satisfied: completes the review (-> IDLE) once the last low-confidence item is reviewed (FR-CE-033)', () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_MULTI_ITEM_REVIEW',
        reviewContext({ currentIndex: 1 }), // last index of a 2-item lowConfidenceDraftIds array
        { type: 'BATCH_ITEM_REVIEWED' },
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-033');
      expect(outcome.nextState).toBe('IDLE');
      expect(outcome.nextContextPayload).toBeNull();
    });

    it('advancing to the next item clears any pending cancel confirmation (implicit "keep reviewing")', () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_MULTI_ITEM_REVIEW',
        reviewContext({ currentIndex: 0, pendingCancelConfirmation: true }),
        { type: 'BATCH_ITEM_REVIEWED' },
      );

      expectAllowed(outcome);
      expect(outcome.nextContextPayload).toMatchObject({ pendingCancelConfirmation: false });
    });

    it('guard-unsatisfied: a batch item review only applies while AWAITING_MULTI_ITEM_REVIEW', () => {
      const outcome = evaluateConversationTransition('IDLE', null, { type: 'BATCH_ITEM_REVIEWED' });

      expectRejected(outcome);
    });
  });

  describe('TASK-BOT-006 — FR-CE-052: AWAITING_MULTI_ITEM_REVIEW cancellation requires explicit confirmation', () => {
    function reviewContext(pendingCancelConfirmation: boolean) {
      return {
        batchId: 'batch-1',
        totalItems: 3,
        highConfidenceDraftIds: ['hc-1'],
        lowConfidenceDraftIds: ['lc-1', 'lc-2'],
        currentIndex: 0,
        pendingCancelConfirmation,
      };
    }

    it("guard-satisfied: the FIRST cancellation asks for confirmation and stays in AWAITING_MULTI_ITEM_REVIEW, unlike FR-CE-047's immediate discard for every other pending state", () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_MULTI_ITEM_REVIEW',
        reviewContext(false),
        { type: 'CANCELLATION' },
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-052');
      expect(outcome.nextState).toBe('AWAITING_MULTI_ITEM_REVIEW');
      expect(outcome.nextContextPayload).toMatchObject({ pendingCancelConfirmation: true });
    });

    it('guard-satisfied: a SECOND cancellation (already pending confirmation) actually discards -> IDLE', () => {
      const outcome = evaluateConversationTransition(
        'AWAITING_MULTI_ITEM_REVIEW',
        reviewContext(true),
        { type: 'CANCELLATION' },
      );

      expectAllowed(outcome);
      expect(outcome.requirementId).toBe('FR-CE-052');
      expect(outcome.nextState).toBe('IDLE');
      expect(outcome.nextContextPayload).toBeNull();
    });

    it("regression — FR-CE-047's immediate, single-tap discard is completely unchanged for the three pre-existing pending states", () => {
      const clarification = evaluateConversationTransition(
        'AWAITING_CLARIFICATION',
        { draftId: 'd', missingField: 'amount', retryCount: 0, lastQuestionAsked: null },
        { type: 'CANCELLATION' },
      );
      expectAllowed(clarification);
      expect(clarification.requirementId).toBe('FR-CE-047');
      expect(clarification.nextState).toBe('IDLE');

      const confirmation = evaluateConversationTransition(
        'AWAITING_CONFIRMATION',
        { transactionId: 't', draftId: 'd', flaggedFields: [] },
        { type: 'CANCELLATION' },
      );
      expectAllowed(confirmation);
      expect(confirmation.requirementId).toBe('FR-CE-047');
      expect(confirmation.nextState).toBe('IDLE');

      const editValue = evaluateConversationTransition(
        'AWAITING_EDIT_VALUE',
        { targetId: 't', targetField: 'amount' },
        { type: 'CANCELLATION' },
      );
      expectAllowed(editValue);
      expect(editValue.requirementId).toBe('FR-CE-047');
      expect(editValue.nextState).toBe('IDLE');
    });
  });

  describe('is a pure function', () => {
    it('is deterministic — the same inputs always produce the same outcome', () => {
      const event = candidateResolvedEvent({ classification: 'auto_commit' });

      expect(evaluateConversationTransition('IDLE', null, event)).toEqual(
        evaluateConversationTransition('IDLE', null, event),
      );
    });

    it('never mutates the context payload it is given', () => {
      const context: AwaitingClarificationContext = {
        draftId: 'd',
        missingField: 'amount',
        retryCount: 0,
        lastQuestionAsked: null,
      };
      const original = { ...context };

      evaluateConversationTransition('AWAITING_CLARIFICATION', context, {
        type: 'CLARIFICATION_ANSWER',
        fieldResolved: false,
        nextQuestion: 'a more specific question',
      });

      expect(context).toEqual(original);
    });
  });
});
