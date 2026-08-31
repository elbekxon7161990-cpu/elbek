/**
 * TASK-AI-002 (Chapter 4 §4.7.2's "Context Element" table; §4.5.3's
 * illustrative USER TURN payload) — the minimum-necessary context a caller
 * must assemble *before* invoking extraction. Assembling the real values
 * (querying recent category usage, reading Redis session state for a
 * pending clarification) is the Context Assembler's job per §4.13.1, but
 * §4.7's own tiering table shows those values are sourced from Session/
 * Dialogue context (Redis) and User Profile context (PostgreSQL) — both
 * owned by Chapter 5/7, out of this task's scope. This type is the
 * boundary contract: TASK-AI-002 defines *what* context extraction needs
 * and how to use it; a later Conversation Engine task is responsible for
 * populating it.
 */
export interface PendingClarificationContext {
  /** The question the bot most recently asked, per §4.14.2's ellipsis-resolution requirement (FR-AI-040). */
  question: string;
}

export interface ExtractionContext {
  /**
   * ISO 8601 with UTC offset, in the user's configured timezone (§4.5.3's
   * sample: `"2026-08-07T14:32:00+05:00"`). Used to resolve relative dates/
   * times (FR-AI-022) — never the server's own timezone.
   */
  currentDateTime: string;
  /** Fallback when currency isn't stated explicitly (§4.4.1's `currency` field notes). */
  userDefaultCurrency: string;
  /** Last ~10 distinct category codes the user has used (§4.7.2) — biases category inference toward the user's own habits. */
  userRecentCategories: readonly string[];
  /** Non-null only when a clarification question is currently pending for this user (FR-AI-040). */
  pendingClarificationContext: PendingClarificationContext | null;
  /**
   * Normalized input text — raw typed text, or an STT transcript, or OCR
   * text (§4.21.2's handoff contract: it enters this same pipeline
   * unchanged, no separate extraction logic per modality). Always treated
   * as untrusted data, never as instructions (§4.17.2).
   */
  inputText: string;
}
