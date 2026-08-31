import { isCancellationPhrase } from './is-cancellation-phrase';
import type { RecordConfidenceClassification } from '../ai-extraction/compute-record-confidence';
import type { AiIntent } from '../ai-extraction/transaction-extraction-schema';

/**
 * TASK-BOT-005 (Chapter 5 §5.12.1's "Interruption Detector" component;
 * §5.6; `BR-CE-011`) — classifies an inbound message received while a
 * pending state is active. Per §5.12.3's own interface contract
 * ("Interruption Detector -> Transition Evaluator ... One of: continuation,
 * unrelated-new-transaction, command, cancellation — never a raw,
 * unclassified message passed back") this function never returns anything
 * outside its declared union; `command` is deliberately excluded from this
 * type (see this file's own scope note below) rather than included and
 * left permanently unreachable.
 *
 * SCOPE (approved 2026-08-14): only the states/flows owned by completed
 * dependencies. `command` classification is not this function's job —
 * Telegraf's `bot.command(...)` handlers are matched and dispatched before
 * `bot.on(message('text'), ...)` ever runs (registration-order middleware
 * composition), so a `/`-prefixed message never reaches
 * `RouteTextMessageUseCase`, and therefore never reaches this function,
 * structurally — see `command-registry.ts` and `telegram-bot.service.ts`'s
 * handler registration order. Command handling is real, existing routing
 * architecture (TASK-BOT-001), not a gap this task fills.
 */
export type InterruptionClassification =
  'continuation' | 'unrelated-new-transaction' | 'cancellation';

export interface ClassifyInterruptionInput {
  /** The raw inbound message text — reused for `isCancellationPhrase` (§5.6/§5.18.3's fixed, admin-maintained phrase list; never AI-inferred, per §5.18.3's own anti-injection rationale). */
  text: string;
  /**
   * The pending draft's already-known intent
   * (`transaction_drafts.partial_data.intent`, TASK-BOT-004's
   * `DraftRepository`) — the baseline "what is this clarification about"
   * this message is compared against. `null` when the draft could not be
   * found (should not happen in production — `routeFreshMessage` always
   * creates the draft before entering `AWAITING_CLARIFICATION` — but
   * handled here rather than assumed): with no baseline to compare
   * against, this function never guesses "unrelated" (AI-P6 fail-closed,
   * the same convention this codebase already applies elsewhere) — see
   * this function's own doc comment.
   */
  pendingIntent: AiIntent | null;
  /** The candidate produced by re-running the EXISTING extraction pipeline (`ExtractTransactionCandidatesUseCase`, unchanged, already invoked by `routeClarificationAnswer` with `pendingClarificationContext` attached, per FR-AI-040) against this same message — `null` if extraction was invalid or produced zero candidates. No second extraction call/system is introduced; this is the same call's own output. */
  reinterpretedIntent: AiIntent | null;
  /** `CandidateGuardrailReport.classification` for that same re-interpreted candidate — the EXISTING §4.6.2 confidence-band function (`classifyRecordConfidence`), already computed by the extraction pipeline for every call; not a new threshold. */
  reinterpretedClassification: RecordConfidenceClassification | null;
}

/**
 * §5.6's own wording — "a clearly new, **unrelated**, **high-confidence**
 * transaction" — and AC-CE-004's "unrelated, high-confidence new
 * transaction message" are the ONLY PRD-literal description of this
 * category, and both qualifiers are given a precise, already-existing,
 * non-invented meaning here:
 *   - "high-confidence" = the SAME `auto_commit` band (`record_confidence
 *     >= 0.85`, §4.6.2) every other auto-commit decision in this codebase
 *     already uses (FR-CE-040) — not a new threshold.
 *   - "unrelated" = a different `intent` than the pending draft's own
 *     stored intent — the plainest, most literal reading of "unrelated"
 *     available without inventing a semantic-similarity rule the PRD does
 *     not specify.
 *
 * Deliberately does NOT also treat a `flagged_review`-band reinterpretation
 * as an interruption: §5.6/AC-CE-004 only describe the high-confidence
 * case, and a `flagged_review` candidate needs its own `AWAITING_CONFIRMATION`
 * context — which cannot coexist with the still-active `AWAITING_CLARIFICATION`
 * context in the single per-user `conversation_state` Redis key (ADR-CE-001)
 * without either overwriting it (silently discarding the pending
 * clarification — forbidden by this task's own instructions) or a guard-table
 * change (also forbidden). A `flagged_review`- or
 * `draft_pending_clarification`-band reinterpretation is therefore
 * classified `continuation` here — the existing FR-CE-042 retry / FR-CE-005
 * fallback machinery already handles a reply that fails to resolve the
 * pending field, which is what this defaults to. This gap (flagged_review
 * interruptions) is reported, not silently handled — see this task's final
 * report.
 */
export function classifyInterruption(input: ClassifyInterruptionInput): InterruptionClassification {
  if (isCancellationPhrase(input.text)) {
    return 'cancellation';
  }

  if (
    input.pendingIntent !== null &&
    input.reinterpretedClassification === 'auto_commit' &&
    input.reinterpretedIntent !== null &&
    input.reinterpretedIntent !== input.pendingIntent
  ) {
    return 'unrelated-new-transaction';
  }

  return 'continuation';
}
