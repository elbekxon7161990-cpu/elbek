export const ACCOUNT_DELETION_CONFIRMATION_REPOSITORY = Symbol(
  'ACCOUNT_DELETION_CONFIRMATION_REPOSITORY',
);

/**
 * TASK-AUTH-006 (Chapter 12 §12.18 — "Yes" → "Type DELETE to confirm.").
 * Ephemeral, Redis-only marker that the NEXT plain-text message from this
 * user should be interpreted as the "type DELETE" answer — mirrors
 * `SearchSessionRepository`/`LoanWizardStateRepository`'s own precedent of
 * a small, dedicated store kept deliberately separate from the closed
 * Conversation Engine state machine.
 *
 * Deliberately NOT a full compare-and-set record like those two: unlike a
 * multi-step draft that accumulates real field data (where a lost race
 * would corrupt the draft), this is a single boolean routing flag with no
 * data of its own — the actual safety-critical operation is
 * `UserRepository.requestDeletion`'s own atomic conditional DB write,
 * which independently protects against a double-request race regardless of
 * this flag's own state. A plain TTL-bounded set/exists/clear is
 * sufficient and is the smaller primitive for what this port actually
 * needs, not a simplification that trades away real safety.
 */
export interface AccountDeletionConfirmationRepository {
  markAwaitingConfirmation(userId: string, expiresAt: Date): Promise<void>;
  isAwaitingConfirmation(userId: string): Promise<boolean>;
  /** One-shot: called immediately after the next text message is read, regardless of whether it matched "DELETE" — the prompt is never answered twice. */
  clear(userId: string): Promise<void>;
}
