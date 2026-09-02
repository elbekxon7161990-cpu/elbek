import type { TransactionExtractionCandidate } from '../ai-extraction/transaction-extraction-schema';
import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';

/**
 * TASK-AI-005 completion round — the voice-originated counterpart to
 * `render-ocr-draft-review-message.ts` (TASK-AI-006), closing the same
 * hand-off gap that file's own doc comment describes, applied to
 * `TranscribeVoiceMessageUseCase` instead of `ProcessReceiptImageUseCase`.
 * Deliberately its own file/functions rather than a shared, source-generic
 * renderer — the copy itself (🎤 vs 📷, "understood your voice message" vs
 * "read your receipt") is genuinely different per source, matching this
 * package's existing per-feature message-renderer precedent (one file per
 * notification family) rather than introducing a parameterized "which
 * emoji/wording" branch into the OCR file.
 *
 * The review card's keyboard reuses `buildOcrDraftReviewKeyboard` UNCHANGED
 * (not duplicated here) — its `ocrdraft_<action>:<draftId>` callback_data
 * scheme and the handler behind it (`RouteOcrDraftCallbackUseCase`) are
 * already fully source-agnostic: they operate on a `TransactionDraftRecord`
 * by id, not on how that draft was created (`draft.sourceType` already
 * carries `'voice'` through untouched). Introducing a parallel
 * `voicedraft_` namespace/handler would duplicate that entire commit path
 * for zero behavioral difference.
 */
export function renderVoiceDraftReviewMessage(
  candidate: TransactionExtractionCandidate,
  language: DetectedLanguage,
): string {
  const amountLine =
    candidate.amount !== null && candidate.currency !== null
      ? `${candidate.amount} ${candidate.currency}`
      : null;
  const parts = [amountLine, candidate.category, candidate.merchant, candidate.transactionDate]
    .filter((part): part is string => part !== null)
    .join(' — ');

  switch (language) {
    case 'uz':
      return `🎤 Ovozli xabaringizni tushundim:\n${parts}\n\nTasdiqlaysizmi?`;
    case 'ru':
      return `🎤 Понял ваше голосовое сообщение:\n${parts}\n\nПодтверждаете?`;
    case 'en':
    default:
      return `🎤 Understood your voice message:\n${parts}\n\nConfirm?`;
  }
}

/** FR-STT-007-style honest failure — the STT/extraction pipeline could not produce a usable candidate at all. Never silent (AI-P6, fail closed). */
export function renderVoiceExtractionFailedMessage(language: DetectedLanguage): string {
  switch (language) {
    case 'uz':
      return "🎤 Kechirasiz, ovozli xabaringizni tushuna olmadim. Iltimos, ma'lumotlarni matn sifatida yozib yuboring.";
    case 'ru':
      return '🎤 Извините, не удалось разобрать ваше голосовое сообщение. Пожалуйста, напишите данные текстом.';
    case 'en':
    default:
      return "🎤 Sorry, I couldn't understand your voice message. Please type the details as text instead.";
  }
}

/** The audio transcribed fine but no transaction-shaped content was found in it. */
export function renderVoiceNoTransactionDetectedMessage(language: DetectedLanguage): string {
  switch (language) {
    case 'uz':
      return "🎤 Bu ovozli xabarda tranzaksiya ma'lumotlarini topa olmadim.";
    case 'ru':
      return '🎤 Не нашёл данные о транзакции в этом голосовом сообщении.';
    case 'en':
    default:
      return "🎤 I couldn't find any transaction details in that voice message.";
  }
}
