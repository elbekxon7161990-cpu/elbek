import { NFR_CE_003_MAX_CLARIFICATION_RETRIES } from './conversation-constants';
import type {
  AwaitingClarificationContext,
  AwaitingConfirmationContext,
  AwaitingMultiItemReviewContext,
  ConversationContextPayload,
  ConversationState,
} from './conversation-state';
import type { ConversationEvent } from './conversation-events';

/**
 * TASK-BOT-002's Transition Evaluator (Chapter 5 §5.13.2's Transition
 * Guard Table) — the single pure function this task exists to build.
 * Every branch below is tagged with the exact `FR-CE-0nn` requirement it
 * implements; every requirement in the guard table has exactly one branch
 * here, and every branch traces to exactly one requirement — no invented
 * transitions, no omitted ones.
 *
 * "Invalid transitions must fail safely": every combination of
 * (state, event) not covered by an explicit guard row returns
 * `{ allowed: false, ... }` rather than throwing or guessing — the caller
 * (this task's application-layer use case) never writes a new state on a
 * rejection, so a malformed/stale/out-of-order event is structurally
 * incapable of corrupting stored state.
 *
 * Deliberately pure and side-effect-free (CE-P1's "state is external"
 * principle applied at the function-signature level too) — it never reads
 * or writes Redis, never calls an AI/domain-service port. The application
 * layer (`ProcessConversationEventUseCase`) is what actually performs the
 * commit side effect this evaluator only *requests*
 * (`commitRequested: true`) — see that use case's own doc comment for why
 * the commit-derived `transactionId` cannot be part of this function's
 * return value (it doesn't exist yet at the point this function runs).
 */

export interface AllowedTransition {
  allowed: true;
  requirementId: string;
  nextState: ConversationState;
  /** Fully known for transitions that don't depend on a commit side effect; `null` when `commitRequested` is true and the caller must build the real payload once it has a `transactionId`. */
  nextContextPayload: ConversationContextPayload;
  commitRequested: boolean;
  /** Only meaningful when `commitRequested` is true — the fields to flag on the confirmation message (FR-CE-012), independent of the not-yet-known `transactionId`. */
  flaggedFieldsIfCommitting: readonly string[];
  /** FR-CE-005 — set only on the AWAITING_CLARIFICATION retry-exhausted branch. */
  fallbackToMiniForm: boolean;
}

export interface RejectedTransition {
  allowed: false;
  requirementId: string | null;
  reason: string;
}

export type TransitionOutcome = AllowedTransition | RejectedTransition;

function allow(
  requirementId: string,
  nextState: ConversationState,
  nextContextPayload: ConversationContextPayload,
  options: Partial<
    Pick<AllowedTransition, 'commitRequested' | 'flaggedFieldsIfCommitting' | 'fallbackToMiniForm'>
  > = {},
): AllowedTransition {
  return {
    allowed: true,
    requirementId,
    nextState,
    nextContextPayload,
    commitRequested: options.commitRequested ?? false,
    flaggedFieldsIfCommitting: options.flaggedFieldsIfCommitting ?? [],
    fallbackToMiniForm: options.fallbackToMiniForm ?? false,
  };
}

function reject(requirementId: string | null, reason: string): RejectedTransition {
  return { allowed: false, requirementId, reason };
}

/** §4.6.1's Medium band boundary (< 0.85) — the same threshold that already governs auto-populate-without-clarification, reused (not reinvented) to derive which fields FR-CE-012 flags on a `flagged_review` confirmation. */
const HIGH_CONFIDENCE_THRESHOLD = 0.85;

function deriveFlaggedFields(candidate: {
  confidenceScores: Record<string, number>;
}): readonly string[] {
  return Object.entries(candidate.confidenceScores)
    .filter(([, score]) => score < HIGH_CONFIDENCE_THRESHOLD)
    .map(([field]) => field);
}

export function evaluateConversationTransition(
  currentState: ConversationState,
  currentContextPayload: ConversationContextPayload,
  event: ConversationEvent,
): TransitionOutcome {
  switch (event.type) {
    case 'CANCELLATION': {
      // FR-CE-047 — "Any pending state -> IDLE". IDLE has nothing to cancel.
      if (currentState === 'IDLE') {
        return reject('FR-CE-047', 'No pending state to cancel.');
      }

      // TASK-BOT-006 (FR-CE-052, §5.20.3) — AWAITING_MULTI_ITEM_REVIEW is
      // the one pending state whose cancellation is NOT immediate: it
      // requires one extra, explicit confirmation before discarding batch
      // progress, unlike every other state's FR-CE-047 immediate discard
      // (unchanged below, for all three of them). A second cancellation
      // (or any further explicit cancel once `pendingCancelConfirmation`
      // is already true) actually discards.
      if (
        currentState === 'AWAITING_MULTI_ITEM_REVIEW' &&
        currentContextPayload !== null &&
        'lowConfidenceDraftIds' in currentContextPayload
      ) {
        if (!currentContextPayload.pendingCancelConfirmation) {
          return allow('FR-CE-052', 'AWAITING_MULTI_ITEM_REVIEW', {
            ...currentContextPayload,
            pendingCancelConfirmation: true,
          });
        }
        return allow('FR-CE-052', 'IDLE', null);
      }

      return allow('FR-CE-047', 'IDLE', null);
    }

    case 'CANDIDATE_RESOLVED': {
      // §5.2.3: IDLE --> IDLE / AWAITING_CLARIFICATION / AWAITING_CONFIRMATION are all FROM IDLE.
      if (currentState !== 'IDLE') {
        return reject(null, 'A resolved candidate only transitions state from IDLE.');
      }

      if (event.classification === 'auto_commit') {
        // FR-CE-040 — record_confidence >= 0.85, direct commit, stays IDLE.
        return allow('FR-CE-040', 'IDLE', null, {
          commitRequested: true,
          flaggedFieldsIfCommitting: [],
        });
      }

      if (event.classification === 'flagged_review') {
        // FR-CE-044 — 0.6 <= record_confidence < 0.85, commit with flagged review.
        const flaggedFields = deriveFlaggedFields(event.candidate);
        return allow('FR-CE-044', 'AWAITING_CONFIRMATION', null, {
          commitRequested: true,
          flaggedFieldsIfCommitting: flaggedFields,
        });
      }

      // event.classification === 'draft_pending_clarification' — FR-CE-041.
      const clarificationContext: AwaitingClarificationContext = {
        draftId: event.draftId,
        missingField: event.missingField,
        retryCount: 0,
        lastQuestionAsked: event.clarificationQuestion,
      };
      return allow('FR-CE-041', 'AWAITING_CLARIFICATION', clarificationContext);
    }

    case 'CLARIFICATION_ANSWER': {
      if (
        currentState !== 'AWAITING_CLARIFICATION' ||
        currentContextPayload === null ||
        !('missingField' in currentContextPayload)
      ) {
        return reject(null, 'A clarification answer only applies while AWAITING_CLARIFICATION.');
      }
      const context = currentContextPayload;

      if (event.fieldResolved) {
        // FR-CE-043 — field resolved, back to IDLE.
        return allow('FR-CE-043', 'IDLE', null);
      }

      if (context.retryCount < NFR_CE_003_MAX_CLARIFICATION_RETRIES) {
        // FR-CE-042 — still unresolved, retry budget remains. BR-CE-003's
        // "re-asks once with a more specific prompt" — `lastQuestionAsked`
        // is replaced with the caller's re-ask, not carried forward
        // unchanged from the original (now-stale) question.
        return allow('FR-CE-042', 'AWAITING_CLARIFICATION', {
          ...context,
          retryCount: context.retryCount + 1,
          lastQuestionAsked: event.nextQuestion,
        });
      }

      // FR-CE-005 — retry budget exhausted (NFR-CE-003), fall back to a manual mini-form. Same state, per §5.19.2's framing of this as a designed recovery path rather than a state transition of its own.
      return allow('FR-CE-005', 'AWAITING_CLARIFICATION', context, { fallbackToMiniForm: true });
    }

    case 'EDIT_REQUESTED': {
      // FR-CE-045 — only from AWAITING_CONFIRMATION.
      if (
        currentState !== 'AWAITING_CONFIRMATION' ||
        currentContextPayload === null ||
        !('transactionId' in currentContextPayload)
      ) {
        return reject('FR-CE-045', 'An edit request only applies while AWAITING_CONFIRMATION.');
      }
      const confirmationContext: AwaitingConfirmationContext = currentContextPayload;
      return allow('FR-CE-045', 'AWAITING_EDIT_VALUE', {
        targetId: confirmationContext.transactionId,
        targetField: event.targetField,
      });
    }

    case 'EDIT_VALUE_PROVIDED': {
      // FR-CE-046 — only from AWAITING_EDIT_VALUE, only when the replacement value itself validates.
      if (currentState !== 'AWAITING_EDIT_VALUE') {
        return reject('FR-CE-046', 'A replacement value only applies while AWAITING_EDIT_VALUE.');
      }
      if (!event.valid) {
        return reject(
          'FR-CE-046',
          'The replacement value failed domain validation — no state change.',
        );
      }
      return allow('FR-CE-046', 'IDLE', null);
    }

    case 'BATCH_REVIEW_STARTED': {
      // §5.2.3: "IDLE -> AWAITING_MULTI_ITEM_REVIEW: bulk import produces N
      // candidates (§5.7)". §5.13.2 itself has no row for this state;
      // FR-CE-030 ("present a summary first") is the closest existing,
      // directly-relevant requirement to tag the entry transition with —
      // not a newly-invented ID (see TASK-BOT-006's final report).
      if (currentState !== 'IDLE') {
        return reject(null, 'A batch review only starts from IDLE.');
      }
      const context: AwaitingMultiItemReviewContext = {
        batchId: event.batchId,
        totalItems: event.totalItems,
        highConfidenceDraftIds: event.highConfidenceDraftIds,
        lowConfidenceDraftIds: event.lowConfidenceDraftIds,
        currentIndex: 0,
        pendingCancelConfirmation: false,
      };
      return allow('FR-CE-030', 'AWAITING_MULTI_ITEM_REVIEW', context);
    }

    case 'BATCH_ITEM_REVIEWED': {
      // FR-CE-032 — advances the paginated low-confidence review by one
      // position; FR-CE-033 tags the completion edge (every low-confidence
      // item reviewed -> IDLE), reusing that requirement's own framing of
      // this state's lifecycle ("progress preserved... until resolved").
      if (
        currentState !== 'AWAITING_MULTI_ITEM_REVIEW' ||
        currentContextPayload === null ||
        !('lowConfidenceDraftIds' in currentContextPayload)
      ) {
        return reject(null, 'A batch item review only applies while AWAITING_MULTI_ITEM_REVIEW.');
      }
      const context = currentContextPayload;
      const nextIndex = context.currentIndex + 1;
      if (nextIndex >= context.lowConfidenceDraftIds.length) {
        return allow('FR-CE-033', 'IDLE', null);
      }
      return allow('FR-CE-032', 'AWAITING_MULTI_ITEM_REVIEW', {
        ...context,
        currentIndex: nextIndex,
        // Any ordinary review action implicitly means "keep going, not
        // cancelling" — closes an open FR-CE-052 confirmation window.
        pendingCancelConfirmation: false,
      });
    }

    default: {
      const exhaustiveCheck: never = event;
      return reject(null, `Unrecognized event: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
