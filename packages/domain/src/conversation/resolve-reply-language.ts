import { DETECTED_LANGUAGES } from '../ai-extraction/transaction-extraction-schema';
import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';

/**
 * TASK-BOT-008 (Chapter 4 §4.2.2) — the single, reusable implementation of
 * §4.2.2's reply-language override rule: "The user's `users.preferred_language`
 * (explicit setting, if set) always overrides auto-detection for bot
 * replies, but never overrides auto-detection for understanding the
 * incoming message." This function is exclusively about the *reply* side of
 * that rule — callers never use it to decide how a message is understood.
 *
 * Deliberately the only place this precedence is decided — every caller
 * (`TelegramBotService`, any future one) calls this instead of re-deriving
 * the same three-step fallback inline, per this task's explicit "do not
 * duplicate language-resolution logic in every message function."
 */
/**
 * `users.preferred_language` (Chapter 13 §13.4) is stored as a plain
 * `TEXT` column with a `CHECK IN ('uz','ru','en')` constraint — the
 * `User` domain entity itself only types it as `string`, and
 * `ProvisionTelegramUserUseCase`'s `derivePreferredLanguage` derives it from
 * Telegram's own free-form `language_code` without validating it against
 * that constraint first. A value that reached this far without matching one
 * of the three supported languages (any other language, a corrupted value)
 * is treated the same as "not set" (AI-P6 "fail closed") — never passed
 * through as if it were a real preference — so `resolveReplyLanguage`
 * safely falls through to `detectedLanguage`/`'en'` instead.
 */
export function toDetectedLanguage(value: string | null | undefined): DetectedLanguage | null {
  return value !== null &&
    value !== undefined &&
    (DETECTED_LANGUAGES as readonly string[]).includes(value)
    ? (value as DetectedLanguage)
    : null;
}

export function resolveReplyLanguage(
  preferredLanguage: DetectedLanguage | null | undefined,
  detectedLanguage: DetectedLanguage | null | undefined,
): DetectedLanguage {
  if (preferredLanguage) {
    return preferredLanguage;
  }
  if (detectedLanguage) {
    return detectedLanguage;
  }
  return 'en';
}
