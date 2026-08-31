/**
 * §5.6/§5.18.3 — "Cancellation-phrase matching is a fixed, admin-maintained
 * phrase list per language, not a free-form pattern... eliminates the
 * injection surface a more permissive free-text cancellation-intent
 * classifier would introduce." §5.6's own table gives the exact phrases:
 * "cancel" / "nevermind" / "bekor qil" / "отмена" — this list, verbatim,
 * nothing added.
 *
 * This is a deliberately minimal slice of the full Interruption Detector
 * (§5.12.1) — classifying continuation vs. unrelated-new-transaction vs.
 * command vs. cancellation is TASK-BOT-005's job (§5.20's full matrix);
 * this task needs only the cancellation branch, since FR-CE-047's guard
 * is the only Interruption Detector output this state machine's own
 * guard table consumes.
 */
const CANCELLATION_PHRASES = ['cancel', 'nevermind', 'never mind', 'bekor qil', 'отмена'] as const;

export function isCancellationPhrase(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return CANCELLATION_PHRASES.some((phrase) => normalized === phrase);
}
