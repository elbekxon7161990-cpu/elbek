import type {
  CategoryAmount,
  DetectedLanguage,
  MerchantAmount,
  ReportDateRange,
  ReportPeriodBucket,
  ReportPeriodTotals,
  ReportTransactionSummary,
  TransactionExtractionCandidate,
  User,
} from '@afa/domain';
import type {
  CashFlowReport,
  CategoryReport,
  CategoryTrajectory,
  DailyReport,
  DebtSummaryReport,
  MerchantReport,
  MonthlyReport,
  OpenDebtSummaryEntry,
  QuarterlyReport,
  SettledDebtSummaryEntry,
  TrendAnalysisReport,
  WeeklyReport,
  YearlyReport,
  CustomRangeReport,
  UpdateUserProfileField,
} from '@afa/application';

/**
 * TASK-BOT-001 (extended TASK-BOT-008, Chapter 5 §5.21/FR-CE-060) — canned,
 * non-business-logic reply text. Kept in one place so no handler inlines a
 * magic string; every message here is either a PRD-mandated fixed response
 * (FR-BOT-004, §7.2.9) or a scope-boundary placeholder for a command/flow
 * whose owning task hasn't landed yet.
 *
 * TASK-BOT-008 — every exported message here now takes a
 * `language: DetectedLanguage` parameter and returns the UZ/RU/EN variant
 * (FR-CE-060: "no flow may fall back to English text for a user whose
 * detected/preferred language is Uzbek or Russian"). The caller
 * (`TelegramBotService`) is responsible for resolving *which* language to
 * pass via `resolveReplyLanguage` (`@afa/domain`, Chapter 4 §4.2.2) — this
 * file only renders, it never decides the language itself, matching the
 * "single reusable helper, not duplicated in every message function" rule.
 *
 * Category values (`candidate.category`, e.g. `'FOOD_DINING'`) are
 * deliberately NOT translated here — `category_translations` (Chapter 13
 * §13.4) has no repository/port surface in this codebase yet
 * (`CategoryRepository`'s own doc comment defers "full category modeling
 * (translations...)" to TASK-FIN-006); inventing a second, hardcoded
 * category-label table here would duplicate that future table and drift
 * from it. See this task's final report for this bounded, deferred gap.
 */

type LocalizedTemplate = Record<DetectedLanguage, string>;

function localize(template: LocalizedTemplate, language: DetectedLanguage): string {
  return template[language];
}

function formatAmountLine(
  candidate: TransactionExtractionCandidate,
  language: DetectedLanguage,
): string {
  if (candidate.amount === null || candidate.currency === null) {
    return localize(
      {
        uz: 'Summa qayd etilmagan',
        ru: 'Сумма не указана',
        en: 'Amount not recorded',
      },
      language,
    );
  }
  return `${candidate.amount.toLocaleString('en-US')} ${candidate.currency}`;
}

function formatCandidateLine(
  candidate: TransactionExtractionCandidate,
  language: DetectedLanguage,
): string {
  const parts = [formatAmountLine(candidate, language)];
  if (candidate.category) {
    parts.push(candidate.category);
  }
  if (candidate.merchant) {
    parts.push(candidate.merchant);
  }
  return parts.join(' — ');
}

/** §7.8.5/§7.2.9 — "MVP scope is 1:1 private chat only." */
export function groupChatRejectionMessage(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Men faqat shaxsiy chatda ishlayman — moliyaviy ma'lumotlaringiz xavfsiz bo'lishi uchun menga to'g'ridan-to'g'ri yozing. Botni qidirib toping va shaxsiy chatda 'Start' tugmasini bosing.",
      ru: 'Я работаю только в личном чате — пожалуйста, напишите мне напрямую, чтобы ваши финансовые данные оставались в безопасности. Найдите этого бота и нажмите «Start» в личном чате.',
      en: "I only work in a private chat — please message me directly so your financial data stays private. Search for this bot and tap 'Start' in a 1:1 chat.",
    },
    language,
  );
}

/** FR-BOT-004 — sticker/location/contact/video and any other recognized-but-unsupported message type. */
export function unsupportedMessageTypeReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bu turdagi xabarni hali qayta ishlay olmayman, lekin mana men nima qila olaman: menga matn xabar, ovozli xabar yoki chek surati yuboring — men uni qayd qilib qo'yaman. Batafsil uchun /help ga yozing.",
      ru: 'Пока не могу обработать такой тип сообщения, но вот что я умею: отправьте мне текстовое сообщение, голосовое сообщение или фото чека — и я всё запишу. Подробнее — /help.',
      en: "I can't process that type of message yet, but here's what I can do: send me a text message, a voice note, or a photo of a receipt, and I'll log it for you. Try /help for more.",
    },
    language,
  );
}

export function documentNotYetSupportedReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bu fayl turini tanidim, lekin uni yuklab olish hali mavjud emas. Hozircha har bir tranzaksiyani matn, ovozli xabar yoki chek surati sifatida ayting.',
      ru: 'Я распознал этот тип файла, но его импорт пока недоступен. А пока просто расскажите мне о каждой операции текстом, голосовым сообщением или фото чека.',
      en: "I recognize this file type, but importing it isn't available yet. In the meantime, you can tell me about each transaction as a text message, voice note, or receipt photo.",
    },
    language,
  );
}

export function documentUnsupportedReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bu fayl turini qayta ishlay olmayman. Xarajat yoki daromadni matn xabar, ovozli xabar yoki chek suratidan qayd qila olaman.',
      ru: 'Не могу обработать этот тип файла. Я умею записывать расходы/доходы из текстового сообщения, голосового сообщения или фото чека.',
      en: "I can't process this file type. I can log expenses/income from a text message, a voice note, or a photo of a receipt.",
    },
    language,
  );
}

export function noTransactionDetectedReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Tushunarli — bu xabarda qayd qiladigan tranzaksiya topa olmadim. Men nima qila olishimni ko'rish uchun /help ga yozing.",
      ru: 'Понял — не нашёл в этом сообщении операцию для записи. Наберите /help, чтобы увидеть, что я умею.',
      en: "Got it — I didn't find a transaction to log in that message. Try /help to see what I can do.",
    },
    language,
  );
}

export function extractionUnknownReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Kechirasiz, buni tushuna olmadim. Boshqacha yozib ko'rasizmi, yoki misollar uchun /help ga buyuring?",
      ru: 'Извините, я не понял это сообщение. Попробуете переформулировать, или наберите /help для примеров?',
      en: "Sorry, I couldn't understand that. Could you try rephrasing, or send /help for examples?",
    },
    language,
  );
}

export function awaitingConfirmationGuidanceReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Iltimos, oxirgi xabarimdagi tugmalardan foydalaning, yoki uni yopish uchun "bekor qilish" deb yozing.',
      ru: 'Пожалуйста, используйте кнопки в моём последнем сообщении, либо напишите «отмена», чтобы закрыть его.',
      en: 'Please use the buttons on my last message, or type "cancel" to dismiss it.',
    },
    language,
  );
}

export function editFieldNotSupportedReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Kechirasiz, bu maydonni tahrirlash hali mavjud emas. Buni yopish va tranzaksiyani qaytadan kiritish uchun "bekor qilish" deb yozing.',
      ru: 'Извините, редактирование этого поля пока недоступно. Напишите «отмена», чтобы закрыть это и ввести операцию заново.',
      en: 'Sorry, editing that field isn\'t supported yet. Type "cancel" to dismiss this and re-enter the transaction instead.',
    },
    language,
  );
}

export function staleCallbackReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bu yozuv allaqachon ko'rib chiqilgan.",
      ru: 'Эта запись уже обработана.',
      en: 'This entry was already handled.',
    },
    language,
  );
}

export function malformedCallbackReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Kechirasiz, bu amalni bajara olmadim.',
      ru: 'Извините, не удалось выполнить это действие.',
      en: "Sorry, I couldn't process that action.",
    },
    language,
  );
}

/** TASK-AI-006 — the confirm tap succeeded and a real transaction now exists. Reuses `formatAmountLine`'s own field-formatting style. */
export function ocrDraftConfirmedReply(
  candidate: TransactionExtractionCandidate,
  language: DetectedLanguage,
): string {
  const parts = [formatAmountLine(candidate, language)];
  if (candidate.category) parts.push(candidate.category);
  if (candidate.merchant) parts.push(candidate.merchant);
  const summary = parts.join(' — ');
  return localize(
    {
      uz: `✅ Saqlandi: ${summary}`,
      ru: `✅ Сохранено: ${summary}`,
      en: `✅ Saved: ${summary}`,
    },
    language,
  );
}

/** The real `TransactionCommitPort` call itself failed (invalid category/currency/etc.) — the draft is left untouched, still tappable again. */
export function ocrDraftCommitFailedReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Kechirasiz, saqlab bo'lmadi. Birozdan so'ng qayta urinib ko'ring.",
      ru: 'Извините, не удалось сохранить. Попробуйте ещё раз чуть позже.',
      en: "Sorry, I couldn't save this. Please try again shortly.",
    },
    language,
  );
}

/** The user's global conversation state was mid an unrelated flow at the exact moment of the tap — no commit was attempted; safe to retry. */
export function ocrDraftRetryReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Hozir band edim, birozdan so'ng qayta urinib ko'ring.",
      ru: 'Я был занят другим — попробуйте ещё раз через минуту.',
      en: 'I was busy with something else — please try again in a moment.',
    },
    language,
  );
}

export function cancelledReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Xo'p, bekor qilindi.",
      ru: 'Хорошо, отменено.',
      en: 'Okay, cancelled.',
    },
    language,
  );
}

export function nothingToCancelReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bekor qiladigan hech narsa yo'q.",
      ru: 'Отменять нечего.',
      en: "There's nothing pending to cancel.",
    },
    language,
  );
}

/** TASK-BOT-004 (FR-CE-013) — a successful Undo tap: the transaction was reversed and the draft marked abandoned. */
export function undoneReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bekor qilindi — bu yozuv o'chirildi.",
      ru: 'Отменено — эта запись удалена.',
      en: 'Undone — that entry has been removed.',
    },
    language,
  );
}

/** FR-CE-020 — `/drafts` with nothing pending. */
export function noDraftsReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Sizda kutilayotgan yozuvlar yo'q. Ajoyib tartib!",
      ru: 'У вас нет незавершённых записей. Полный порядок!',
      en: "You don't have any pending entries. Nice and tidy!",
    },
    language,
  );
}

/** TASK-BOT-005 (§5.6 row 1, ADR-CE-006) — appended, verbatim, to the confirmation of an unrelated, high-confidence transaction that interrupted a still-pending clarification; the pending entry itself is never discarded. */
export function interruptionNote(language: DetectedLanguage): string {
  return localize(
    {
      uz: "(Aytgancha, avvalgi yozuvingiz haqida ma'lumot hali ham kerak — istalgan vaqtda javob bering yoki /drafts deb yozing)",
      ru: '(Кстати, мне всё ещё нужны детали по вашей более ранней записи — ответьте в любое время или напишите /drafts)',
      en: '(By the way, I still need details on your earlier entry — reply anytime or type /drafts)',
    },
    language,
  );
}

export function helpMessage(language: DetectedLanguage): string {
  return localize(
    {
      uz: [
        'Mana men nima qila olaman:',
        '- "45000 ga tushlik qildim" kabi matn xabar yuboring — men uni qayd qilaman.',
        '- Tranzaksiyani tasvirlab ovozli xabar yuboring.',
        '- Chek suratini yuboring.',
        '- Oxirgi so\'ragan narsamni yopish uchun istalgan vaqtda "bekor qilish" deb yozing.',
        '',
        'Buyruqlar: /start /help /cancel',
      ].join('\n'),
      ru: [
        'Вот что я умею:',
        '- Отправьте текст, например «потратил 45000 на обед» — я это запишу.',
        '- Отправьте голосовое сообщение с описанием операции.',
        '- Отправьте фото чека.',
        '- Напишите «отмена» в любой момент, чтобы закрыть последний заданный вопрос.',
        '',
        'Команды: /start /help /cancel',
      ].join('\n'),
      en: [
        "Here's what I can do:",
        '- Send a text message like "spent 45000 on lunch" and I\'ll log it.',
        '- Send a voice note describing a transaction.',
        '- Send a photo of a receipt.',
        '- Type "cancel" any time to dismiss whatever I last asked you.',
        '',
        'Commands: /start /help /cancel',
      ].join('\n'),
    },
    language,
  );
}

/** Registered but owned by a not-yet-built module (Chapters 8-10) — a graceful placeholder, not a re-implementation of that module. */
export function commandNotYetAvailableReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bu hali mavjud emas — tez orada qayta tekshiring!',
      ru: 'Это пока недоступно — загляните позже!',
      en: "This isn't available yet — check back soon!",
    },
    language,
  );
}

/**
 * TASK-BOT-004 (FR-CE-010/011/012) — the real, value-bearing confirmation
 * message every committed candidate must produce; replaces the pre-existing
 * `candidateConfirmationSummary` placeholder (generic "Got it, logged!"
 * text with no actual amount/category shown, matching FR-CE-010's "silent
 * background logging with no user-facing trace is never acceptable" only in
 * that *a* message was sent, not in *what* it said). Reads `candidate`'s
 * fields directly and never rounds/reformats the amount beyond
 * locale-grouping — no field here is invented or altered. Per §5.21.3, the
 * amount stays the visually leading element in all three languages.
 */
export function renderConfirmationMessage(
  candidate: TransactionExtractionCandidate,
  flaggedFields: readonly string[],
  language: DetectedLanguage,
): string {
  const parts = [formatAmountLine(candidate, language)];
  if (candidate.category) {
    parts.push(candidate.category);
  }
  if (candidate.merchant) {
    parts.push(candidate.merchant);
  }
  if (candidate.transactionDate) {
    parts.push(candidate.transactionDate);
  }
  const summaryLine = `✅ ${parts.join(' — ')}`;

  if (flaggedFields.length === 0) {
    return summaryLine;
  }
  const note = localize(
    {
      uz: `(${flaggedFields.join(', ')} bo'yicha to'liq ishonchim yo'q — tuzatish uchun Tahrirlash, yoki yozuvni olib tashlash uchun Bekor qilishni bosing.)`,
      ru: `(Не совсем уверен насчёт: ${flaggedFields.join(', ')} — нажмите «Изменить», чтобы исправить, или «Отменить», чтобы удалить запись.)`,
      en: `(Not fully confident about: ${flaggedFields.join(', ')} — tap Edit to fix, or Undo to remove this entry.)`,
    },
    language,
  );
  return `${summaryLine}\n${note}`;
}

/**
 * TASK-BOT-006 (FR-CE-030) — the degenerate all-high-confidence batch case:
 * `AWAITING_MULTI_ITEM_REVIEW` was never entered (see
 * `BatchAllHighConfidenceCommittedOutcome`'s own doc comment), so this is
 * both the summary AND the final word on this batch, not a two-message flow.
 */
export function renderBatchAllHighConfidenceCommittedMessage(
  outcome: {
    totalItems: number;
    committedCount: number;
    failedCount: number;
  },
  language: DetectedLanguage,
): string {
  const base = localize(
    {
      uz: `✅ ${outcome.totalItems} ta tranzaksiya topildi — barchasi yuqori ishonchli, avtomatik qayd qilindi.`,
      ru: `✅ Найдено операций: ${outcome.totalItems} — все с высокой уверенностью, записаны автоматически.`,
      en: `✅ Found ${outcome.totalItems} transaction${outcome.totalItems === 1 ? '' : 's'} — all high-confidence, logged automatically.`,
    },
    language,
  );
  if (outcome.failedCount === 0) {
    return base;
  }
  const note = localize(
    {
      uz: `(Ulardan ${outcome.failedCount} tasi saqlanmadi — iltimos, /drafts ni tekshiring.)`,
      ru: `(${outcome.failedCount} из них не удалось сохранить — проверьте /drafts.)`,
      en: `(${outcome.failedCount} of them couldn't be saved — please check /drafts.)`,
    },
    language,
  );
  return `${base}\n${note}`;
}

/** TASK-BOT-006 (FR-CE-030) — the required summary-first message when a real batch review starts. */
export function renderBatchSummaryMessage(
  outcome: {
    totalItems: number;
    highConfidenceCount: number;
    lowConfidenceCount: number;
  },
  language: DetectedLanguage,
): string {
  return localize(
    {
      uz: `${outcome.totalItems} ta tranzaksiya topildi — ${outcome.highConfidenceCount} tasi yuqori ishonchli, ${outcome.lowConfidenceCount} tasini ko'rib chiqish kerak.`,
      ru: `Найдено операций: ${outcome.totalItems} — ${outcome.highConfidenceCount} с высокой уверенностью, ${outcome.lowConfidenceCount} нужно проверить.`,
      en: `Found ${outcome.totalItems} transactions — ${outcome.highConfidenceCount} high-confidence, ${outcome.lowConfidenceCount} need review.`,
    },
    language,
  );
}

/** TASK-BOT-006 (FR-CE-032) — one paginated low-confidence item, with clear position indication. */
export function renderBatchItemMessage(
  candidate: TransactionExtractionCandidate,
  position: number,
  total: number,
  language: DetectedLanguage,
): string {
  const header = localize(
    {
      uz: `📋 Ko'rib chiqish kerak: ${position}-band, jami ${total} tadan:`,
      ru: `📋 Требует проверки: ${position} из ${total}:`,
      en: `📋 Item ${position} of ${total} needing review:`,
    },
    language,
  );
  const line = formatCandidateLine(candidate, language);
  const description = candidate.description ? `\n${candidate.description}` : '';
  return `${header}\n${line}${description}`;
}

/** TASK-BOT-006 (FR-CE-033) — every low-confidence item has been reviewed (confirmed or skipped). */
export function batchReviewCompleteReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Oxirgisi shu edi — ko'rib chiqish yakunlandi.",
      ru: 'Это была последняя — проверка завершена.',
      en: 'That was the last one — batch review complete.',
    },
    language,
  );
}

/** TASK-BOT-006 (FR-CE-031) — the "Import N confident ones now" tap result. */
export function renderBatchHighConfidenceCommittedMessage(
  outcome: {
    committedCount: number;
    failedCount: number;
  },
  language: DetectedLanguage,
): string {
  if (outcome.committedCount === 0 && outcome.failedCount === 0) {
    return localize(
      {
        uz: 'Ular allaqachon qayd qilingan edi.',
        ru: 'Они уже были записаны.',
        en: 'Those were already logged.',
      },
      language,
    );
  }
  const base = localize(
    {
      uz: `✅ ${outcome.committedCount} ta ishonchli yozuv qayd qilindi.`,
      ru: `✅ Записано уверенных операций: ${outcome.committedCount}.`,
      en: `✅ Logged ${outcome.committedCount} confident entr${outcome.committedCount === 1 ? 'y' : 'ies'}.`,
    },
    language,
  );
  if (outcome.failedCount === 0) {
    return base;
  }
  const note = localize(
    {
      uz: `(${outcome.failedCount} tasi saqlanmadi — iltimos, /drafts ni tekshiring.)`,
      ru: `(${outcome.failedCount} не удалось сохранить — проверьте /drafts.)`,
      en: `(${outcome.failedCount} couldn't be saved — please check /drafts.)`,
    },
    language,
  );
  return `${base}\n${note}`;
}

/** TASK-BOT-006 (FR-CE-052) — the first cancellation tap/phrase while AWAITING_MULTI_ITEM_REVIEW; distinct from `cancelledReply`, which is reserved for an actual discard. */
export function batchCancelConfirmationReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Ko'rib chiqishning qolgan qismini bekor qilaymi? Tasdiqlangan yozuvlaringiz saqlanib qoladi, lekin hali ko'rib chiqilmagan bandlar bekor qilinadi. Tasdiqlash uchun yana bir marta \"bekor qilish\" deb yozing, yoki ko'rib chiqishni davom ettiring.",
      ru: 'Отменить оставшуюся часть проверки? Подтверждённые записи останутся сохранёнными, но ещё не проверенные пункты будут отменены. Напишите «отмена» ещё раз для подтверждения, либо продолжите проверку.',
      en: 'Cancel the rest of this batch review? Your confirmed entries stay logged, but any items you haven\'t reviewed yet will be discarded. Type "cancel" again to confirm, or keep reviewing.',
    },
    language,
  );
}

export function clarificationAckReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Rahmat, hozir yangilayapman.',
      ru: 'Спасибо, сейчас обновляю.',
      en: 'Thanks, updating that now.',
    },
    language,
  );
}

export function editValueInvalidReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bu to'g'ri qiymatga o'xshamayapti — qaytadan urinib ko'ring, yoki \"bekor qilish\" deb yozing.",
      ru: 'Это не похоже на верное значение — попробуйте ещё раз, либо напишите «отмена».',
      en: 'That doesn\'t look like a valid value — please try again, or type "cancel".',
    },
    language,
  );
}

export function editValueAcceptedReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Yangilandi.',
      ru: 'Обновлено.',
      en: 'Updated.',
    },
    language,
  );
}

export function voiceAckReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Qabul qildim, ovozli xabaringizni tahlil qilyapman...',
      ru: 'Принято, анализирую ваше голосовое сообщение...',
      en: 'Got it, analyzing your voice message...',
    },
    language,
  );
}

export function photoAckReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Qabul qildim, suratingizni tahlil qilyapman...',
      ru: 'Принято, анализирую ваше фото...',
      en: 'Got it, analyzing your photo...',
    },
    language,
  );
}

export function voiceInvalidReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Ovozli xabar to'g'ri kelmadi — qaytadan yuborib ko'rasizmi?",
      ru: 'Голосовое сообщение не дошло корректно — попробуете отправить ещё раз?',
      en: "That voice message didn't come through properly — could you try sending it again?",
    },
    language,
  );
}

export function photoInvalidReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Surat to'g'ri kelmadi — qaytadan yuborib ko'rasizmi?",
      ru: 'Фото не дошло корректно — попробуете отправить ещё раз?',
      en: "That photo didn't come through properly — could you try sending it again?",
    },
    language,
  );
}

export function storageFailureReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Kechirasiz, buni saqlashda xatolik yuz berdi. Iltimos, birozdan so'ng qaytadan urinib ko'ring.",
      ru: 'Извините, при сохранении произошла ошибка. Пожалуйста, попробуйте ещё раз через некоторое время.',
      en: 'Sorry, something went wrong on my end saving that. Please try again in a moment.',
    },
    language,
  );
}

/** TASK-BOT-008 — the `/start` welcome message for a brand-new user. */
export function welcomeNewUserMessage(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Xush kelibsiz! Men sizning AI moliyaviy yordamchingizman — menga xarajat yoki daromad haqida gapirib bering, men uni qayd qilib boraman.',
      ru: 'Добро пожаловать! Я ваш ИИ-помощник по финансам — просто расскажите мне о расходе или доходе, и я буду всё записывать.',
      en: "Welcome! I'm your AI Personal Finance Assistant — just tell me about an expense or income and I'll track it for you.",
    },
    language,
  );
}

/** TASK-BOT-008 — the `/start` welcome-back message for a returning user. */
export function welcomeReturningUserMessage(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Qaytganingizdan xursandman! Menga qayd qilinadigan narsani yuboring, yoki nima qila olishimni ko'rish uchun /help ga yozing.",
      ru: 'С возвращением! Пришлите мне что-нибудь для записи, либо наберите /help, чтобы увидеть, что я умею.',
      en: 'Welcome back! Send me anything to log, or /help to see what I can do.',
    },
    language,
  );
}

/** TASK-BOT-008 — the "What should it be?" prompt after an Edit button tap (FR-CE-013). */
export function editPromptReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Nima bo'lishi kerak?",
      ru: 'Каким должно быть новое значение?',
      en: 'What should it be?',
    },
    language,
  );
}

/** TASK-BOT-008 — `/drafts`' list header (FR-CE-020). */
export function draftsListHeader(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Kutilayotgan yozuvlaringiz:',
      ru: 'Ваши незавершённые записи:',
      en: 'Your pending entries:',
    },
    language,
  );
}

function amountUnknownLabel(language: DetectedLanguage): string {
  return localize(
    {
      uz: "summa noma'lum",
      ru: 'сумма неизвестна',
      en: 'amount unknown',
    },
    language,
  );
}

function stillNeedsLabel(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'hali kerak',
      ru: 'ещё нужно',
      en: 'still needs',
    },
    language,
  );
}

/** FR-CE-020 — concise, most-recent-first `/drafts` listing; PRD-supported info only (amount/category/what's still missing), no additional draft-management features. */
export function renderDraftsList(
  drafts: readonly {
    partialData: { amount: number | null; currency: string | null; category: string | null };
    missingFields: readonly string[];
  }[],
  language: DetectedLanguage,
): string {
  if (drafts.length === 0) {
    return noDraftsReply(language);
  }
  const lines = drafts.map((draft, index) => {
    const amount =
      draft.partialData.amount !== null && draft.partialData.currency !== null
        ? `${draft.partialData.amount.toLocaleString('en-US')} ${draft.partialData.currency}`
        : amountUnknownLabel(language);
    const missing =
      draft.missingFields.length > 0
        ? ` — ${stillNeedsLabel(language)}: ${draft.missingFields.join(', ')}`
        : '';
    return `${index + 1}. ${amount}${draft.partialData.category ? ` — ${draft.partialData.category}` : ''}${missing}`;
  });
  return [draftsListHeader(language), ...lines].join('\n');
}

/** TASK-FIN-002 (FR-DBT-006) — `/debts` with no open debts at all. */
export function noOpenDebtsReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Sizda hozircha ochiq qarzlar yo'q.",
      ru: 'У вас пока нет открытых долгов.',
      en: "You don't have any open debts right now.",
    },
    language,
  );
}

function debtsGivenHeader(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Siz qarz berdingiz:',
      ru: 'Вы дали в долг:',
      en: 'You are owed:',
    },
    language,
  );
}

function debtsReceivedHeader(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Sizning qarzlaringiz:',
      ru: 'Вы должны:',
      en: 'You owe:',
    },
    language,
  );
}

function debtDueLabel(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'muddati',
      ru: 'срок',
      en: 'due',
    },
    language,
  );
}

function formatDebtLine(
  debt: {
    counterpartyName: string;
    outstandingBalance: string;
    currency: string;
    dueDate: Date | null;
  },
  index: number,
  language: DetectedLanguage,
): string {
  // `outstandingBalance` is displayed as its own canonical decimal string,
  // never through `Number()` (DB-P3/FR-DB-027 — no money value is ever
  // routed through IEEE-754 float, including at this display boundary).
  const amount = `${debt.outstandingBalance} ${debt.currency}`;
  const due = debt.dueDate
    ? ` (${debtDueLabel(language)}: ${debt.dueDate.toISOString().slice(0, 10)})`
    : '';
  return `${index + 1}. ${debt.counterpartyName} — ${amount}${due}`;
}

/**
 * FR-DBT-006 — `/debts`: the user's own open debts, grouped by
 * given/received direction, sorted by due date (the use case's own
 * repository call already returns them in that order — this function does
 * not re-sort). Each input list is expected to already be filtered to one
 * user (`ListOpenDebtsUseCase`'s own contract) — no filtering happens here.
 */
export function renderDebtsList(
  debts: readonly {
    direction: 'given' | 'received';
    counterpartyName: string;
    outstandingBalance: string;
    currency: string;
    dueDate: Date | null;
  }[],
  language: DetectedLanguage,
): string {
  if (debts.length === 0) {
    return noOpenDebtsReply(language);
  }

  const given = debts.filter((debt) => debt.direction === 'given');
  const received = debts.filter((debt) => debt.direction === 'received');

  const sections: string[] = [];
  if (given.length > 0) {
    sections.push(
      [
        debtsGivenHeader(language),
        ...given.map((debt, i) => formatDebtLine(debt, i, language)),
      ].join('\n'),
    );
  }
  if (received.length > 0) {
    sections.push(
      [
        debtsReceivedHeader(language),
        ...received.map((debt, i) => formatDebtLine(debt, i, language)),
      ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

// ============================================================================
// TASK-FIN-003 — Budget System (Chapter 8 §8.4)
// ============================================================================

export function noActiveBudgetsReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Sizda hozircha faol byudjetlar yo'q. Yaratish uchun: /budget create <kategoriya yoki overall> <summa> <davr>",
      ru: 'У вас пока нет активных бюджетов. Чтобы создать: /budget create <категория или overall> <сумма> <период>',
      en: 'You have no active budgets yet. To create one: /budget create <category or overall> <amount> <period>',
    },
    language,
  );
}

/** FR-BUD-006 — a text-based progress bar (Telegram has no native rich progress widget). 10 segments, filled proportionally to utilization, capped at 100% visually (an over-limit budget still shows a full bar, not an overflowing one). */
function renderProgressBar(utilizationPercent: number): string {
  const segments = 10;
  const filled = Math.max(0, Math.min(segments, Math.round((utilizationPercent / 100) * segments)));
  return '█'.repeat(filled) + '░'.repeat(segments - filled);
}

function budgetScopeLabel(
  budget: { scopeType: 'category' | 'overall'; categoryId: string | null },
  language: DetectedLanguage,
): string {
  if (budget.scopeType === 'overall') {
    return localize({ uz: 'Umumiy', ru: 'Общий', en: 'Overall' }, language);
  }
  return (
    budget.categoryId ?? localize({ uz: 'Kategoriya', ru: 'Категория', en: 'Category' }, language)
  );
}

function daysRemainingLabel(days: number, language: DetectedLanguage): string {
  return localize(
    { uz: `${days} kun qoldi`, ru: `осталось ${days} дн.`, en: `${days} day(s) left` },
    language,
  );
}

interface BudgetListEntry {
  budget: {
    scopeType: 'category' | 'overall';
    categoryId: string | null;
    limitAmount: string;
    currency: string;
  };
  usedAmount: string;
  utilizationPercent: number;
  remainingAmount: string;
  daysRemainingInPeriod: number;
}

/** FR-BUD-006 — `/budget`: every active budget with its live utilization, a text progress bar, and remaining days in period (§8.4.8 AC-BUD-001's own worked example). */
export function renderBudgetsList(
  entries: readonly BudgetListEntry[],
  language: DetectedLanguage,
): string {
  if (entries.length === 0) {
    return noActiveBudgetsReply(language);
  }

  return entries
    .map((entry) => {
      const label = budgetScopeLabel(entry.budget, language);
      const bar = renderProgressBar(entry.utilizationPercent);
      const percent = entry.utilizationPercent.toFixed(1);
      const amounts = `${entry.usedAmount} / ${entry.budget.limitAmount} ${entry.budget.currency}`;
      const days = daysRemainingLabel(entry.daysRemainingInPeriod, language);
      return `${label}\n${bar} ${percent}%\n${amounts} — ${days}`;
    })
    .join('\n\n');
}

export function budgetCreateUsageReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Byudjet yaratish: /budget create <kategoriya kodi yoki overall> <summa> <davr: weekly|monthly|quarterly|yearly>\nMisol: /budget create FOOD_DINING 2000000 monthly',
      ru: 'Создать бюджет: /budget create <код категории или overall> <сумма> <период: weekly|monthly|quarterly|yearly>\nПример: /budget create FOOD_DINING 2000000 monthly',
      en: 'Create a budget: /budget create <category code or overall> <amount> <period: weekly|monthly|quarterly|yearly>\nExample: /budget create FOOD_DINING 2000000 monthly',
    },
    language,
  );
}

export function budgetCreatedReply(
  scopeLabel: string,
  limitAmount: string,
  currency: string,
  language: DetectedLanguage,
): string {
  return localize(
    {
      uz: `✅ "${scopeLabel}" uchun ${limitAmount} ${currency} byudjet yaratildi.`,
      ru: `✅ Бюджет "${scopeLabel}" на ${limitAmount} ${currency} создан.`,
      en: `✅ Budget "${scopeLabel}" created — ${limitAmount} ${currency}.`,
    },
    language,
  );
}

/** §8.4.7 — "offers to update the existing budget instead of creating a conflicting second one." */
export function budgetDuplicateReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bu davr uchun bunday byudjet allaqachon mavjud. Uni /budget orqali ko'ring va tahrirlang.",
      ru: 'Такой бюджет на этот период уже существует. Посмотрите и отредактируйте его через /budget.',
      en: 'A budget for this scope already exists this period. View and edit it via /budget instead.',
    },
    language,
  );
}

export function budgetInvalidArgsReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Summani yoki davrni tushunmadim.',
      ru: 'Не удалось распознать сумму или период.',
      en: "I couldn't understand the amount or period.",
    },
    language,
  );
}

export function budgetCategoryNotFoundReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bunday kategoriya topilmadi.',
      ru: 'Такая категория не найдена.',
      en: 'No matching category found.',
    },
    language,
  );
}

// ============================================================================
// TASK-FIN-004 Stage I — Loan Telegram UX (Chapter 8 §8.8, FR-FIN-009)
// ============================================================================

/** FR-FIN-009 — `/loans` with no open loans at all. */
export function noOpenLoansReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Sizda hozircha ochiq kreditlar yo'q. Yangi kredit qo'shish uchun /loans create yozing.",
      ru: 'У вас пока нет открытых кредитов. Чтобы добавить новый, напишите /loans create.',
      en: "You don't have any open loans right now. Send /loans create to add one.",
    },
    language,
  );
}

function loanNextDueLabel(language: DetectedLanguage): string {
  return localize({ uz: 'keyingi to‘lov', ru: 'след. платёж', en: 'next due' }, language);
}

function formatLoanListLine(
  loan: {
    lender: string;
    outstandingBalance: string;
    currency: string;
    installmentAmount: string;
    nextDueDate: Date;
  },
  index: number,
  language: DetectedLanguage,
): string {
  // Money values are always rendered as their own canonical decimal string,
  // never through `Number()` (DB-P3/FR-DB-027).
  const balance = `${loan.outstandingBalance} ${loan.currency}`;
  const installment = `${loan.installmentAmount} ${loan.currency}`;
  const due = loan.nextDueDate.toISOString().slice(0, 10);
  return `${index + 1}. ${loan.lender} — ${balance} (${installment}, ${loanNextDueLabel(language)}: ${due})`;
}

/**
 * FR-FIN-009 — `/loans`: every open loan's lender, outstanding balance,
 * next installment amount, and next due date. `nextDueDate` is a live,
 * caller-supplied derived value (`calculateNextLoanDueDate`, @afa/domain) —
 * this function only formats it, never computes it (no business logic in
 * the Telegram layer).
 */
export function renderLoansList(
  loans: readonly {
    lender: string;
    outstandingBalance: string;
    currency: string;
    installmentAmount: string;
    nextDueDate: Date;
  }[],
  language: DetectedLanguage,
): string {
  if (loans.length === 0) {
    return noOpenLoansReply(language);
  }
  return loans.map((loan, i) => formatLoanListLine(loan, i, language)).join('\n');
}

export function loanNotFoundReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bunday kredit topilmadi.',
      ru: 'Такой кредит не найден.',
      en: 'No matching loan found.',
    },
    language,
  );
}

function loanFrequencyLabel(frequency: string, language: DetectedLanguage): string {
  const labels: Record<string, LocalizedTemplate> = {
    weekly: { uz: 'haftalik', ru: 'еженедельно', en: 'weekly' },
    monthly: { uz: 'oylik', ru: 'ежемесячно', en: 'monthly' },
    quarterly: { uz: 'choraklik', ru: 'ежеквартально', en: 'quarterly' },
  };
  return labels[frequency] ? localize(labels[frequency]!, language) : frequency;
}

/** `/loans <id>` — full detail view of a single loan (FR-FIN-009's presentation pattern extended to the single-record case). */
export function renderLoanDetails(
  loan: {
    lender: string;
    principalAmount: string;
    outstandingBalance: string;
    currency: string;
    interestRate: string | null;
    installmentAmount: string;
    installmentFrequency: string;
    status: string;
    nextDueDate: Date | null;
  },
  language: DetectedLanguage,
): string {
  const lines = [
    `${loan.lender}`,
    localize({ uz: 'Boshlang‘ich summa', ru: 'Первоначальная сумма', en: 'Principal' }, language) +
      `: ${loan.principalAmount} ${loan.currency}`,
    localize({ uz: 'Qolgan qarz', ru: 'Остаток долга', en: 'Outstanding balance' }, language) +
      `: ${loan.outstandingBalance} ${loan.currency}`,
    localize({ uz: 'Foiz stavkasi', ru: 'Процентная ставка', en: 'Interest rate' }, language) +
      ': ' +
      (loan.interestRate === null
        ? localize({ uz: 'foizsiz', ru: 'без процентов', en: 'interest-free' }, language)
        : `${loan.interestRate}`),
    localize({ uz: 'Har safar to‘lov', ru: 'Платёж', en: 'Installment' }, language) +
      `: ${loan.installmentAmount} ${loan.currency} (${loanFrequencyLabel(loan.installmentFrequency, language)})`,
  ];
  if (loan.status === 'paid_off') {
    lines.push(
      localize(
        { uz: 'To‘liq to‘langan ✅', ru: 'Полностью погашен ✅', en: 'Fully paid off ✅' },
        language,
      ),
    );
  } else if (loan.nextDueDate) {
    lines.push(`${loanNextDueLabel(language)}: ${loan.nextDueDate.toISOString().slice(0, 10)}`);
  }
  return lines.join('\n');
}

export function loansUsageReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Buyruqlar: /loans (ro‘yxat), /loans create (yangi kredit), /loans pay (to‘lov), /loans <id> (tafsilotlar).',
      ru: 'Команды: /loans (список), /loans create (новый кредит), /loans pay (платёж), /loans <id> (детали).',
      en: 'Commands: /loans (list), /loans create (new loan), /loans pay (payment), /loans <id> (details).',
    },
    language,
  );
}

// --- Loan creation wizard ---------------------------------------------------

export function askLoanLenderReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Kredit beruvchi nomini kiriting (masalan, 'Ipoteka Bank').",
      ru: "Введите название кредитора (например, 'Ipoteka Bank').",
      en: "Enter the lender's name (e.g. 'Ipoteka Bank').",
    },
    language,
  );
}

export function invalidLoanLenderReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Nomi bo'sh bo'lishi mumkin emas. Qayta kiriting.",
      ru: 'Название не может быть пустым. Повторите ввод.',
      en: "The name can't be empty. Please try again.",
    },
    language,
  );
}

export function askLoanPrincipalReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Kredit summasini kiriting (masalan, 10000000).',
      ru: 'Введите сумму кредита (например, 10000000).',
      en: 'Enter the loan principal amount (e.g. 10000000).',
    },
    language,
  );
}

export function invalidLoanPrincipalReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Summani tushunmadim — musbat son kiriting.',
      ru: 'Не удалось распознать сумму — введите положительное число.',
      en: "I couldn't understand the amount — enter a positive number.",
    },
    language,
  );
}

export function askLoanCurrencyReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Valyutasini kiriting (masalan, UZS).',
      ru: 'Введите валюту (например, UZS).',
      en: 'Enter the currency (e.g. UZS).',
    },
    language,
  );
}

export function invalidLoanCurrencyReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bunday valyuta topilmadi. Qayta kiriting.',
      ru: 'Такая валюта не найдена. Повторите ввод.',
      en: "That currency isn't recognized. Please try again.",
    },
    language,
  );
}

export function askLoanInterestRateReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Yillik foiz stavkasini kiriting (masalan, 12). Foizsiz bo'lsa 'yo'q' deb yozing.",
      ru: "Введите годовую процентную ставку (например, 12). Если без процентов — напишите 'нет'.",
      en: "Enter the annual interest rate (e.g. 12). If interest-free, type 'none'.",
    },
    language,
  );
}

export function invalidLoanInterestRateReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Tushunmadim — foiz sonini kiriting yoki 'yo'q' deb yozing.",
      ru: "Не понял — введите число процентов или напишите 'нет'.",
      en: "I couldn't understand that — enter a percentage number or type 'none'.",
    },
    language,
  );
}

export function askLoanInstallmentAmountReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Har safar to'lanadigan summani kiriting.",
      ru: 'Введите сумму каждого платежа.',
      en: 'Enter the installment amount.',
    },
    language,
  );
}

export function invalidLoanInstallmentAmountReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Summani tushunmadim — musbat son kiriting.',
      ru: 'Не удалось распознать сумму — введите положительное число.',
      en: "I couldn't understand the amount — enter a positive number.",
    },
    language,
  );
}

export function askLoanInstallmentFrequencyReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "To'lov davri qanday? weekly (haftalik) / monthly (oylik) / quarterly (choraklik).",
      ru: 'Периодичность платежа? weekly (еженедельно) / monthly (ежемесячно) / quarterly (ежеквартально).',
      en: 'Installment frequency? weekly / monthly / quarterly.',
    },
    language,
  );
}

export function invalidLoanInstallmentFrequencyReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'weekly, monthly yoki quarterly deb yozing.',
      ru: 'Напишите weekly, monthly или quarterly.',
      en: 'Please type weekly, monthly, or quarterly.',
    },
    language,
  );
}

export function askLoanStartDateReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Boshlanish sanasini kiriting (YYYY-MM-DD).',
      ru: 'Введите дату начала (ГГГГ-ММ-ДД).',
      en: 'Enter the start date (YYYY-MM-DD).',
    },
    language,
  );
}

export function invalidLoanStartDateReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Sana formatini tushunmadim — YYYY-MM-DD ko'rinishida kiriting.",
      ru: 'Не удалось распознать дату — введите в формате ГГГГ-ММ-ДД.',
      en: "I couldn't understand the date — use YYYY-MM-DD.",
    },
    language,
  );
}

export function renderLoanCreateConfirmation(
  draft: {
    lender: string;
    principalAmount: string;
    currency: string;
    interestRate: string | null;
    installmentAmount: string;
    installmentFrequency: string;
    startDate: string;
  },
  language: DetectedLanguage,
): string {
  const interest =
    draft.interestRate === null
      ? localize({ uz: 'foizsiz', ru: 'без процентов', en: 'interest-free' }, language)
      : `${draft.interestRate}`;
  const summary = [
    `${draft.lender} — ${draft.principalAmount} ${draft.currency}`,
    `${interest}, ${draft.installmentAmount} ${draft.currency} (${loanFrequencyLabel(draft.installmentFrequency, language)})`,
    `${localize({ uz: 'Boshlanish sanasi', ru: 'Дата начала', en: 'Start date' }, language)}: ${draft.startDate}`,
  ].join('\n');
  const question = localize(
    { uz: 'Tasdiqlaysizmi?', ru: 'Подтвердить?', en: 'Confirm?' },
    language,
  );
  return `${summary}\n\n${question}`;
}

export function loanCreatedReply(language: DetectedLanguage): string {
  return localize(
    { uz: 'Kredit yaratildi. ✅', ru: 'Кредит создан. ✅', en: 'Loan created. ✅' },
    language,
  );
}

export function loanCreateCancelledReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Kredit yaratish bekor qilindi.',
      ru: 'Создание кредита отменено.',
      en: 'Loan creation cancelled.',
    },
    language,
  );
}

// --- Loan payment wizard -----------------------------------------------------

export function noOpenLoansForPaymentReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "To'lov qilish uchun ochiq kredit yo'q.",
      ru: 'Нет открытых кредитов для оплаты.',
      en: 'There are no open loans to pay.',
    },
    language,
  );
}

export function askLoanSelectionReply(
  loans: readonly { lender: string; outstandingBalance: string; currency: string }[],
  language: DetectedLanguage,
): string {
  const lines = loans.map(
    (loan, i) => `${i + 1}. ${loan.lender} — ${loan.outstandingBalance} ${loan.currency}`,
  );
  const prompt = localize(
    {
      uz: "Qaysi kredit uchun to'lov qilasiz? Raqamini yozing.",
      ru: 'За какой кредит платите? Введите номер.',
      en: 'Which loan are you paying? Enter its number.',
    },
    language,
  );
  return [prompt, ...lines].join('\n');
}

export function invalidLoanSelectionReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Ro'yxatdagi raqamlardan birini yozing.",
      ru: 'Введите один из номеров списка.',
      en: 'Enter one of the numbers from the list.',
    },
    language,
  );
}

export function askLoanPaymentAmountReply(
  loan: { lender: string; outstandingBalance: string; currency: string },
  language: DetectedLanguage,
): string {
  const context = `${loan.lender} — ${loan.outstandingBalance} ${loan.currency}`;
  const prompt = localize(
    {
      uz: "To'lov summasini kiriting.",
      ru: 'Введите сумму платежа.',
      en: 'Enter the payment amount.',
    },
    language,
  );
  return `${context}\n${prompt}`;
}

export function invalidLoanPaymentAmountReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Summani tushunmadim — musbat son kiriting.',
      ru: 'Не удалось распознать сумму — введите положительное число.',
      en: "I couldn't understand the amount — enter a positive number.",
    },
    language,
  );
}

export function renderLoanPaymentConfirmation(
  loan: { lender: string; outstandingBalance: string; currency: string },
  amount: string,
  language: DetectedLanguage,
): string {
  const summary = `${loan.lender}: ${amount} ${loan.currency}`;
  const question = localize(
    { uz: 'Tasdiqlaysizmi?', ru: 'Подтвердить?', en: 'Confirm?' },
    language,
  );
  return `${summary}\n${question}`;
}

/** Renders the full applied-payment breakdown: amount, interest portion, principal portion, remaining outstanding balance, and paid_off status — all values as returned by `LogLoanPaymentUseCase`, never recomputed here (no amortization logic in the Telegram layer). */
export function renderLoanPaymentResult(
  result: {
    amount: string;
    interestPortion: string;
    principalPortion: string;
    outstandingBalance: string;
    currency: string;
    paidOff: boolean;
  },
  language: DetectedLanguage,
): string {
  const lines = [
    `${localize({ uz: "To'lov", ru: 'Платёж', en: 'Payment' }, language)}: ${result.amount} ${result.currency}`,
    `${localize({ uz: 'Foiz qismi', ru: 'Проценты', en: 'Interest portion' }, language)}: ${result.interestPortion} ${result.currency}`,
    `${localize({ uz: 'Asosiy qism', ru: 'Основной долг', en: 'Principal portion' }, language)}: ${result.principalPortion} ${result.currency}`,
    `${localize({ uz: 'Qolgan qarz', ru: 'Остаток долга', en: 'Remaining balance' }, language)}: ${result.outstandingBalance} ${result.currency}`,
  ];
  if (result.paidOff) {
    lines.push(
      localize(
        {
          uz: 'Kredit to‘liq to‘landi! ✅',
          ru: 'Кредит полностью погашен! ✅',
          en: 'Loan fully paid off! ✅',
        },
        language,
      ),
    );
  }
  return lines.join('\n');
}

export function loanPaymentCancelledReply(language: DetectedLanguage): string {
  return localize(
    { uz: "To'lov bekor qilindi.", ru: 'Платёж отменён.', en: 'Payment cancelled.' },
    language,
  );
}

export function loanOverpaymentReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bu summa qolgan qarzdan katta. Kamroq summa kiriting.',
      ru: 'Эта сумма больше остатка долга. Введите меньшую сумму.',
      en: 'That amount exceeds the outstanding balance. Enter a smaller amount.',
    },
    language,
  );
}

export function loanNegativeAmortizationReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bu summa hisoblangan foizni ham qoplay olmaydi. Ko'proq summa kiriting.",
      ru: 'Эта сумма не покрывает даже начисленные проценты. Введите сумму побольше.',
      en: "That amount doesn't even cover the interest due. Enter a larger amount.",
    },
    language,
  );
}

export function loanPaymentConflictReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bu to'lov allaqachon qayta ishlangan yoki eskirgan. /loans pay bilan qaytadan boshlang.",
      ru: 'Этот платёж уже обработан или устарел. Начните заново через /loans pay.',
      en: 'This payment was already processed or is stale. Start again with /loans pay.',
    },
    language,
  );
}

export function noActiveLoanWizardReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Faol so'rov yo'q.",
      ru: 'Нет активного запроса.',
      en: 'No active request.',
    },
    language,
  );
}

// ============================================================================
// TASK-REP-004 — Dashboard Fast Path (Chapter 9 §9.3, §9.8)
// ============================================================================

/** §9.3.6 AC — a brand-new user with no data gets a friendly onboarding reply, never a wall of zeros. */
export function dashboardEmptyReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Hali hech narsa qayd etilmagan — birinchi xarajat yoki daromadingiz haqida yozib ko'ring!",
      ru: 'Пока ничего не записано — напишите о своём первом расходе или доходе!',
      en: 'Nothing logged yet — try telling me about a recent expense or income!',
    },
    language,
  );
}

function dashboardHeader(periodKey: string, language: DetectedLanguage): string {
  return localize(
    {
      uz: `📊 Bugungi holat (${periodKey})`,
      ru: `📊 Сводка (${periodKey})`,
      en: `📊 Dashboard (${periodKey})`,
    },
    language,
  );
}

function dashboardSpentLine(totalExpense: string, language: DetectedLanguage): string {
  return `${localize({ uz: 'Sarflandi', ru: 'Потрачено', en: 'Spent' }, language)}: ${totalExpense}`;
}

function dashboardIncomeLine(totalIncome: string, language: DetectedLanguage): string {
  return `${localize({ uz: 'Daromad', ru: 'Доход', en: 'Income' }, language)}: ${totalIncome}`;
}

function dashboardCashFlowLine(netCashFlow: string, language: DetectedLanguage): string {
  return `${localize({ uz: 'Sof pul oqimi', ru: 'Чистый денежный поток', en: 'Net cash flow' }, language)}: ${netCashFlow}`;
}

function dashboardCategoriesSection(
  topCategories: readonly { categoryId: string; totalAmount: string }[],
  language: DetectedLanguage,
): string | null {
  if (topCategories.length === 0) {
    return null;
  }
  const header = localize(
    {
      uz: 'Eng ko‘p sarflangan kategoriyalar',
      ru: 'Больше всего потрачено по категориям',
      en: 'Top spending categories',
    },
    language,
  );
  const lines = topCategories.map(
    (category, i) => `${i + 1}. ${category.categoryId} — ${category.totalAmount}`,
  );
  return [header, ...lines].join('\n');
}

function dashboardBudgetSection(
  overallBudgetUtilization: {
    usedAmount: string;
    utilizationPercent: number;
    budget: { limitAmount: string; currency: string };
  } | null,
  language: DetectedLanguage,
): string | null {
  if (overallBudgetUtilization === null) {
    return null;
  }
  const header = localize(
    { uz: 'Umumiy byudjet', ru: 'Общий бюджет', en: 'Overall budget' },
    language,
  );
  const bar = renderProgressBar(overallBudgetUtilization.utilizationPercent);
  const percent = overallBudgetUtilization.utilizationPercent.toFixed(1);
  const amounts = `${overallBudgetUtilization.usedAmount} / ${overallBudgetUtilization.budget.limitAmount} ${overallBudgetUtilization.budget.currency}`;
  return `${header}\n${bar} ${percent}%\n${amounts}`;
}

function formatDebtDirectionTotals(
  totalOutstandingByCurrency: readonly { currency: string; totalOutstanding: string }[],
): string {
  return totalOutstandingByCurrency
    .map((entry) => `${entry.totalOutstanding} ${entry.currency}`)
    .join(', ');
}

function dashboardDebtsSection(
  openDebtsGiven: {
    count: number;
    totalOutstandingByCurrency: readonly { currency: string; totalOutstanding: string }[];
  },
  openDebtsReceived: {
    count: number;
    totalOutstandingByCurrency: readonly { currency: string; totalOutstanding: string }[];
  },
  language: DetectedLanguage,
): string | null {
  if (openDebtsGiven.count === 0 && openDebtsReceived.count === 0) {
    return null;
  }
  const header = localize(
    { uz: 'Ochiq qarzlar', ru: 'Открытые долги', en: 'Open debts' },
    language,
  );
  const lines: string[] = [];
  if (openDebtsGiven.count > 0) {
    const label = localize({ uz: 'Berilgan', ru: 'Дано в долг', en: 'Given' }, language);
    lines.push(
      `${label}: ${openDebtsGiven.count} — ${formatDebtDirectionTotals(openDebtsGiven.totalOutstandingByCurrency)}`,
    );
  }
  if (openDebtsReceived.count > 0) {
    const label = localize({ uz: 'Olingan', ru: 'Взято в долг', en: 'Received' }, language);
    lines.push(
      `${label}: ${openDebtsReceived.count} — ${formatDebtDirectionTotals(openDebtsReceived.totalOutstandingByCurrency)}`,
    );
  }
  return [header, ...lines].join('\n');
}

function dashboardDraftsLine(pendingDraftCount: number, language: DetectedLanguage): string | null {
  if (pendingDraftCount === 0) {
    return null;
  }
  return `${localize({ uz: 'Kutilayotgan yozuvlar', ru: 'Ожидающие черновики', en: 'Pending drafts' }, language)}: ${pendingDraftCount}`;
}

/**
 * FR-DSH-001 — a single message with every required figure. Sections whose
 * underlying value is genuinely absent (no overall budget set, no open
 * debts, no pending drafts) are omitted entirely rather than shown as a
 * misleading zero/empty line, mirroring `renderBudgetsList`'s own
 * established convention for "nothing to show here."
 */
export function renderDashboard(
  summary: {
    periodKey: string;
    totalExpense: string;
    totalIncome: string;
    netCashFlow: string;
    topCategories: readonly { categoryId: string; totalAmount: string }[];
    overallBudgetUtilization: {
      usedAmount: string;
      utilizationPercent: number;
      budget: { limitAmount: string; currency: string };
    } | null;
    openDebtsGiven: {
      count: number;
      totalOutstandingByCurrency: readonly { currency: string; totalOutstanding: string }[];
    };
    openDebtsReceived: {
      count: number;
      totalOutstandingByCurrency: readonly { currency: string; totalOutstanding: string }[];
    };
    pendingDraftCount: number;
  },
  language: DetectedLanguage,
): string {
  const sections = [
    dashboardHeader(summary.periodKey, language),
    [
      dashboardSpentLine(summary.totalExpense, language),
      dashboardIncomeLine(summary.totalIncome, language),
      dashboardCashFlowLine(summary.netCashFlow, language),
    ].join('\n'),
    dashboardCategoriesSection(summary.topCategories, language),
    dashboardBudgetSection(summary.overallBudgetUtilization, language),
    dashboardDebtsSection(summary.openDebtsGiven, summary.openDebtsReceived, language),
    dashboardDraftsLine(summary.pendingDraftCount, language),
  ].filter((section): section is string => section !== null);

  return sections.join('\n\n');
}

// ============================================================================
// TASK-FIN-012 — Search (Chapter 10 §10.3)
// ============================================================================

interface SearchFiltersDisplay {
  category?: string;
  merchant?: string;
  transactionType?: string;
  dateFrom?: string;
  dateTo?: string;
  minAmount?: string;
  maxAmount?: string;
  tags?: readonly string[];
}

function searchFilterSummaryLines(
  filters: SearchFiltersDisplay,
  language: DetectedLanguage,
): string[] {
  const lines: string[] = [];
  if (filters.category) {
    lines.push(
      `• ${localize({ uz: 'Kategoriya', ru: 'Категория', en: 'Category' }, language)}: ${filters.category}`,
    );
  }
  if (filters.merchant) {
    lines.push(
      `• ${localize({ uz: "Do'kon", ru: 'Магазин', en: 'Merchant' }, language)}: ${filters.merchant}`,
    );
  }
  if (filters.transactionType) {
    lines.push(
      `• ${localize({ uz: 'Turi', ru: 'Тип', en: 'Type' }, language)}: ${filters.transactionType}`,
    );
  }
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ?? '…';
    const to = filters.dateTo ?? '…';
    lines.push(`• ${localize({ uz: 'Sana', ru: 'Дата', en: 'Date' }, language)}: ${from} → ${to}`);
  }
  if (filters.minAmount || filters.maxAmount) {
    const min = filters.minAmount ?? '0';
    const max = filters.maxAmount ?? '∞';
    lines.push(
      `• ${localize({ uz: 'Summa', ru: 'Сумма', en: 'Amount' }, language)}: ${min} – ${max}`,
    );
  }
  if (filters.tags && filters.tags.length > 0) {
    lines.push(
      `• ${localize({ uz: 'Teglar', ru: 'Теги', en: 'Tags' }, language)}: ${filters.tags.join(', ')}`,
    );
  }
  return lines;
}

/** FR-SCH-001 — the guided filter menu's own message, shown above `buildSearchFilterMenuKeyboard`. */
export function searchFilterMenuReply(
  filters: SearchFiltersDisplay,
  language: DetectedLanguage,
): string {
  const header = localize(
    {
      uz: 'Qidiruv filtrlari — kerakli filtrni tanlang, keyin "Qidirish"ni bosing:',
      ru: 'Фильтры поиска — выберите нужный, затем нажмите «Искать»:',
      en: 'Search filters — pick what you want to filter by, then tap "Search":',
    },
    language,
  );
  const summary = searchFilterSummaryLines(filters, language);
  return summary.length > 0 ? `${header}\n\n${summary.join('\n')}` : header;
}

export function askSearchCategoryReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Kategoriya kodini yozing (masalan: FOOD_DINING).',
      ru: 'Введите код категории (например: FOOD_DINING).',
      en: 'Type a category code (e.g. FOOD_DINING).',
    },
    language,
  );
}

export function invalidSearchCategoryReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bunday kategoriya topilmadi. Boshqa kod bilan urinib ko'ring.",
      ru: 'Такая категория не найдена. Попробуйте другой код.',
      en: "That category wasn't found. Try a different code.",
    },
    language,
  );
}

export function askSearchMerchantReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Do'kon/sotuvchi nomini (yoki uning bir qismini) yozing.",
      ru: 'Введите название магазина (или его часть).',
      en: 'Type a merchant name (or part of one).',
    },
    language,
  );
}

export function askSearchDateFromReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Boshlanish sanasini kiriting (YYYY-MM-DD).',
      ru: 'Введите дату начала (ГГГГ-ММ-ДД).',
      en: 'Enter the start date (YYYY-MM-DD).',
    },
    language,
  );
}

export function askSearchDateToReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Tugash sanasini kiriting (YYYY-MM-DD).',
      ru: 'Введите дату окончания (ГГГГ-ММ-ДД).',
      en: 'Enter the end date (YYYY-MM-DD).',
    },
    language,
  );
}

export function invalidSearchDateReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Sana formati noto'g'ri. YYYY-MM-DD ko'rinishida yozing (masalan: 2026-03-15).",
      ru: 'Неверный формат даты. Введите в формате ГГГГ-ММ-ДД (например: 2026-03-15).',
      en: 'Invalid date format. Use YYYY-MM-DD (e.g. 2026-03-15).',
    },
    language,
  );
}

export function askSearchMinAmountReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Minimal summani kiriting (masalan: 10000).',
      ru: 'Введите минимальную сумму (например: 10000).',
      en: 'Enter the minimum amount (e.g. 10000).',
    },
    language,
  );
}

export function askSearchMaxAmountReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Maksimal summani kiriting (masalan: 100000).',
      ru: 'Введите максимальную сумму (например: 100000).',
      en: 'Enter the maximum amount (e.g. 100000).',
    },
    language,
  );
}

export function invalidSearchAmountReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Summa noto'g'ri. Musbat son kiriting (masalan: 15000 yoki 15000.50).",
      ru: 'Неверная сумма. Введите положительное число (например: 15000 или 15000.50).',
      en: 'Invalid amount. Enter a positive number (e.g. 15000 or 15000.50).',
    },
    language,
  );
}

export function askSearchTagsReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Teglarni vergul bilan ajratib yozing (masalan: oziq-ovqat, sovg'a).",
      ru: 'Введите теги через запятую (например: продукты, подарок).',
      en: 'Enter tags separated by commas (e.g. groceries, gift).',
    },
    language,
  );
}

export function searchSessionExpiredReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Qidiruv sessiyasi tugadi. Qaytadan boshlash uchun /search yozing.',
      ru: 'Сессия поиска истекла. Начните заново с /search.',
      en: 'Your search session expired. Start again with /search.',
    },
    language,
  );
}

export function searchNoResultsReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Hech narsa topilmadi. Filtrlarni o'zgartirib ko'ring.",
      ru: 'Ничего не найдено. Попробуйте изменить фильтры.',
      en: 'Nothing found. Try adjusting your filters.',
    },
    language,
  );
}

export function searchResultDeletedReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "O'chirildi.",
      ru: 'Удалено.',
      en: 'Deleted.',
    },
    language,
  );
}

export function searchResultAlreadyGoneReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bu yozuv allaqachon oʻchirilgan yoki topilmadi.',
      ru: 'Эта запись уже удалена или не найдена.',
      en: 'That entry was already deleted or no longer exists.',
    },
    language,
  );
}

function formatSearchResultLine(
  result: {
    amount: string;
    currency: string;
    transactionType: string;
    categoryId: string;
    merchant: string | null;
    transactionDate: Date;
    description: string;
  },
  index: number,
): string {
  const date = result.transactionDate.toISOString().slice(0, 10);
  const merchantPart = result.merchant ? ` — ${result.merchant}` : '';
  return `${index + 1}. ${date} — ${result.amount} ${result.currency} — ${result.categoryId}${merchantPart}\n   ${result.description}`;
}

/** FR-SCH-003 — one page of results, "enough detail to identify the transaction" (date/amount/category/description), 1-based numbering matching the per-result Delete buttons `buildSearchResultsKeyboard` renders in the same order. */
export function renderSearchResults(
  results: readonly {
    amount: string;
    currency: string;
    transactionType: string;
    categoryId: string;
    merchant: string | null;
    transactionDate: Date;
    description: string;
  }[],
  page: number,
  totalCount: number,
  language: DetectedLanguage,
): string {
  if (results.length === 0) {
    return searchNoResultsReply(language);
  }
  const header = localize(
    {
      uz: `Topildi: ${totalCount} ta (${page + 1}-sahifa)`,
      ru: `Найдено: ${totalCount} (стр. ${page + 1})`,
      en: `Found: ${totalCount} (page ${page + 1})`,
    },
    language,
  );
  const lines = results.map((r, i) => formatSearchResultLine(r, i));
  return [header, ...lines].join('\n\n');
}

// ============================================================================
// TASK-AUTH-006 — Account Deletion Flow (Chapter 12 §12.18)
// ============================================================================

/** §12.18 step 1 — shown with `buildAccountDeletionConfirmKeyboard`. */
export function accountDeletionConfirmPromptReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "⚠️ Bu hisobingiz va barcha ma'lumotlaringizni 30 kunlik muddatdan so'ng butunlay o'chiradi. Ishonchingiz komilmi?",
      ru: '⚠️ Это приведёт к полному удалению вашего аккаунта и всех данных через 30 дней. Вы уверены?',
      en: '⚠️ This will permanently delete your account and all data after a 30-day grace period. Are you sure?',
    },
    language,
  );
}

/** §12.18 step 2 — the high-friction typed-word confirmation (ADR-FLW-003). */
export function accountDeletionTypeToConfirmReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Tasdiqlash uchun DELETE deb yozing.',
      ru: 'Напишите DELETE, чтобы подтвердить.',
      en: 'Type DELETE to confirm.',
    },
    language,
  );
}

/** Anything other than the exact literal "DELETE" — the request is NOT confirmed, no state change. */
export function accountDeletionWrongTextReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bekor qilindi — aniq "DELETE" so\'zi kiritilmadi. Hisobingiz o\'zgarishsiz qoldi.',
      ru: 'Отменено — не был введён точный текст «DELETE». Ваш аккаунт не изменён.',
      en: 'Cancelled — the exact word "DELETE" was not entered. Your account is unchanged.',
    },
    language,
  );
}

/** FR-RET-003 — request-time confirmation, sent immediately once the account is marked `pending_deletion`. */
export function accountDeletionRequestedReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "✅ Hisobingiz o'chirishga belgilandi. 30 kun ichida hech qanday amal bajarilmasa, barcha ma'lumotlaringiz butunlay o'chiriladi. Bu davrda bot funksiyalari to'xtatiladi.",
      ru: '✅ Ваш аккаунт помечен на удаление. Если в течение 30 дней ничего не изменится, все ваши данные будут окончательно удалены. На это время функции бота приостановлены.',
      en: '✅ Your account has been marked for deletion. If nothing changes within 30 days, all your data will be permanently deleted. Bot functionality is suspended during this period.',
    },
    language,
  );
}

/**
 * Generic, honest status reply for a `RequestAccountDeletionUseCase`
 * `not_eligible` outcome — deliberately reports current status only,
 * without asserting any further consequence (e.g. whether/how to reverse
 * it) this task did not resolve.
 */
export function accountDeletionNotEligibleReply(
  currentStatus: string,
  language: DetectedLanguage,
): string {
  return localize(
    {
      uz: `Hisobingiz hozir "${currentStatus}" holatida — yangi o'chirish so'rovi qabul qilinmadi.`,
      ru: `Ваш аккаунт сейчас в статусе «${currentStatus}» — новый запрос на удаление не принят.`,
      en: `Your account is currently in "${currentStatus}" status — a new deletion request was not accepted.`,
    },
    language,
  );
}

/**
 * FR-RET-001 — "all bot functionality suspended immediately." Shown by the
 * auth middleware for every blocked update from a `pending_deletion`/
 * `deleted` user (every update except the "Cancel account deletion" button
 * and a repeated `/deleteaccount`, which the middleware lets through
 * instead — see `telegram-bot.service.ts`'s own middleware doc comment).
 * `daysRemaining` gives an honest, concrete grace-period status on every
 * such reply, not just a generic "suspended" notice.
 */
export function accountSuspendedPendingDeletionReply(
  daysRemaining: number,
  language: DetectedLanguage,
): string {
  return localize(
    {
      uz: `Hisobingiz o'chirish jarayonida — funksiyalar vaqtincha to'xtatilgan. ${daysRemaining} kundan so'ng butunlay o'chiriladi.`,
      ru: `Ваш аккаунт находится в процессе удаления — функции временно приостановлены. Будет окончательно удалён через ${daysRemaining} дн.`,
      en: `Your account is pending deletion — functionality is temporarily suspended. It will be permanently deleted in ${daysRemaining} day(s).`,
    },
    language,
  );
}

/** TASK-AUTH-006 — repeated `/deleteaccount` while already `pending_deletion`: an honest status report, never a second request. */
export function accountDeletionAlreadyPendingReply(
  daysRemaining: number,
  language: DetectedLanguage,
): string {
  return localize(
    {
      uz: `Hisobingiz allaqachon o'chirishga belgilangan — ${daysRemaining} kun qoldi. Fikringizdan qaytmoqchimisiz?`,
      ru: `Ваш аккаунт уже помечен на удаление — осталось ${daysRemaining} дн. Хотите отменить?`,
      en: `Your account is already scheduled for deletion — ${daysRemaining} day(s) remaining. Want to reverse this?`,
    },
    language,
  );
}

/** TASK-AUTH-006 (FR-RET-001 — "recoverable if the user reverses the request") — the cancellation succeeded, full access restored. */
export function accountDeletionCancelledReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "✅ Hisobingizni o'chirish bekor qilindi. Barcha ma'lumotlaringiz saqlanib qoldi, botdan to'liq foydalanishingiz mumkin.",
      ru: '✅ Удаление аккаунта отменено. Все ваши данные сохранены, полный доступ к боту восстановлен.',
      en: '✅ Account deletion has been cancelled. All your data is intact and full bot access is restored.',
    },
    language,
  );
}

/** TASK-AUTH-006 — the "Cancel account deletion" button was pressed after the 30-day grace period had already elapsed. */
export function accountDeletionGracePeriodExpiredReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Afsuski, 30 kunlik muddat allaqachon tugagan — bu amalni endi bekor qilib bo'lmaydi.",
      ru: 'К сожалению, 30-дневный срок уже истёк — это больше нельзя отменить.',
      en: 'The 30-day grace period has already ended — this can no longer be cancelled.',
    },
    language,
  );
}

/** TASK-AUTH-006 — a stale "Cancel account deletion" tap when the account is not (or no longer) pending_deletion at all (e.g. already purged and re-provisioned as a fresh account). */
export function accountDeletionCancelNotPendingReply(
  currentStatus: string,
  language: DetectedLanguage,
): string {
  return localize(
    {
      uz: `Hisobingiz hozir "${currentStatus}" holatida — o'chirish so'rovi topilmadi.`,
      ru: `Ваш аккаунт сейчас в статусе «${currentStatus}» — запрос на удаление не найден.`,
      en: `Your account is currently in "${currentStatus}" status — no deletion request was found.`,
    },
    language,
  );
}

/**
 * TASK-AUTH-006 (FR-RET-002 — the final, irreversible-completion
 * confirmation). Sent only after a verified-successful purge, via the
 * dedicated `AccountPurgeNotificationQueue`/processor — never through the
 * normal reply flow, since by the time this fires the user's own `users`
 * row (and this bot's ability to look anything up about them) is gone.
 */
export function accountPurgeCompletedReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Hisobingiz va barcha ma'lumotlaringiz butunlay o'chirildi. Xayr!",
      ru: 'Ваш аккаунт и все данные были окончательно удалены. Прощайте!',
      en: 'Your account and all associated data have been permanently deleted. Goodbye.',
    },
    language,
  );
}

// ============================================================================
// /report Telegram wiring — Chapter 9, GenerateReportUseCase (@afa/application)
// ============================================================================

const MAX_REPORT_LIST_ITEMS = 10;

export function reportMenuReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: '📊 Qaysi hisobotni ko‘rmoqchisiz?',
      ru: '📊 Какой отчёт вы хотите посмотреть?',
      en: '📊 Which report would you like to see?',
    },
    language,
  );
}

/** §9.3.6-style friendly empty state, reused across every one of the 11 report types (rule: never a wall of zeros, never a bare "no data" with no next step). */
export function reportEmptyReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bu davr uchun yetarli ma'lumot yo'q. Boshqa hisobot yoki davrni tanlab ko'ring.",
      ru: 'Недостаточно данных за этот период. Попробуйте другой отчёт или период.',
      en: 'Not enough data for that yet. Try a different report or period.',
    },
    language,
  );
}

/** Never leaks internal error details/stack traces — the sole safe reply for any `GenerateReportUseCase` failure. */
export function reportErrorReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Hisobotni tayyorlab bo'lmadi. Birozdan so'ng qayta urinib ko'ring.",
      ru: 'Не удалось подготовить отчёт. Попробуйте ещё раз чуть позже.',
      en: "Couldn't generate that report. Please try again shortly.",
    },
    language,
  );
}

export function reportRangePromptReply(language: DetectedLanguage): string {
  return localize(
    { uz: 'Qaysi davr uchun?', ru: 'За какой период?', en: 'For which period?' },
    language,
  );
}

export function reportCategoryPickerReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'So‘nggi kunlardagi eng ko‘p xarajat kategoriyasini tanlang:',
      ru: 'Выберите категорию с наибольшими расходами за последние дни:',
      en: 'Pick one of your recent top-spending categories:',
    },
    language,
  );
}

export function reportMerchantPickerReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "So'nggi kunlardagi eng ko'p sarflangan do'konni tanlang:",
      ru: 'Выберите магазин с наибольшими расходами за последние дни:',
      en: 'Pick one of your recent top-spending merchants:',
    },
    language,
  );
}

function formatReportDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatReportDateRange(range: ReportDateRange): string {
  return `${formatReportDate(range.start)} → ${formatReportDate(range.end)}`;
}

function reportSpentLine(totalExpense: string, language: DetectedLanguage): string {
  return `${localize({ uz: 'Sarflandi', ru: 'Потрачено', en: 'Spent' }, language)}: ${totalExpense}`;
}

function reportIncomeLine(totalIncome: string, language: DetectedLanguage): string {
  return `${localize({ uz: 'Daromad', ru: 'Доход', en: 'Income' }, language)}: ${totalIncome}`;
}

function boundedLines<T>(
  items: readonly T[],
  toLine: (item: T, index: number) => string,
  language: DetectedLanguage,
): string[] {
  const shown = items.slice(0, MAX_REPORT_LIST_ITEMS);
  const lines = shown.map(toLine);
  const remaining = items.length - shown.length;
  if (remaining > 0) {
    lines.push(
      localize(
        {
          uz: `... yana ${remaining} ta`,
          ru: `... ещё ${remaining}`,
          en: `... and ${remaining} more`,
        },
        language,
      ),
    );
  }
  return lines;
}

function reportCategoryBreakdownSection(
  categoryBreakdown: readonly CategoryAmount[],
  language: DetectedLanguage,
): string | null {
  if (categoryBreakdown.length === 0) {
    return null;
  }
  const header = localize(
    { uz: 'Kategoriyalar bo‘yicha', ru: 'По категориям', en: 'By category' },
    language,
  );
  const lines = boundedLines(
    categoryBreakdown,
    (c, i) => `${i + 1}. ${c.categoryId} — ${c.totalAmount}`,
    language,
  );
  return [header, ...lines].join('\n');
}

function reportMerchantBreakdownSection(
  merchantBreakdown: readonly MerchantAmount[],
  language: DetectedLanguage,
): string | null {
  if (merchantBreakdown.length === 0) {
    return null;
  }
  const header = localize(
    { uz: 'Do‘konlar bo‘yicha', ru: 'По магазинам', en: 'By merchant' },
    language,
  );
  const lines = boundedLines(
    merchantBreakdown,
    (m, i) => `${i + 1}. ${m.merchant} — ${m.totalAmount} (${m.transactionCount})`,
    language,
  );
  return [header, ...lines].join('\n');
}

function reportPeriodicTrendSection(
  header: string,
  buckets: readonly ReportPeriodBucket[],
  language: DetectedLanguage,
): string | null {
  if (buckets.length === 0) {
    return null;
  }
  const spentLabel = localize({ uz: 'Sarf', ru: 'Расх.', en: 'Exp' }, language);
  const incomeLabel = localize({ uz: 'Daromad', ru: 'Дох.', en: 'Inc' }, language);
  const lines = boundedLines(
    buckets,
    (b) =>
      `${formatReportDate(b.bucketStart)}: ${spentLabel} ${b.totalExpense}, ${incomeLabel} ${b.totalIncome}`,
    language,
  );
  return [header, ...lines].join('\n');
}

function reportComparisonLine(
  label: Record<DetectedLanguage, string>,
  comparison: ReportPeriodTotals | null,
  language: DetectedLanguage,
): string | null {
  if (comparison === null) {
    return null;
  }
  return `${localize(label, language)}: ${reportSpentLine(comparison.totalExpense, language)}, ${reportIncomeLine(comparison.totalIncome, language)}`;
}

function composeReport(sections: ReadonlyArray<string | null>): string {
  return sections.filter((s): s is string => s !== null).join('\n\n');
}

export function renderDailyReport(report: DailyReport, language: DetectedLanguage): string | null {
  const isEmpty =
    report.totalExpense === '0.00' &&
    report.totalIncome === '0.00' &&
    report.categoryBreakdown.length === 0;
  if (isEmpty) {
    return null;
  }

  const header = localize(
    {
      uz: `📅 Kunlik hisobot (${report.periodKey})`,
      ru: `📅 Дневной отчёт (${report.periodKey})`,
      en: `📅 Daily report (${report.periodKey})`,
    },
    language,
  );
  const averageLine =
    report.comparisonToDailyAverage === null
      ? null
      : `${localize({ uz: '30 kunlik o‘rtacha', ru: 'Среднее за 30 дн.', en: '30-day average' }, language)}: ${report.comparisonToDailyAverage.averageDailyExpense}`;

  return composeReport([
    header,
    [
      reportSpentLine(report.totalExpense, language),
      reportIncomeLine(report.totalIncome, language),
    ].join('\n'),
    averageLine,
    reportCategoryBreakdownSection(report.categoryBreakdown, language),
  ]);
}

export function renderWeeklyReport(
  report: WeeklyReport,
  language: DetectedLanguage,
): string | null {
  const isEmpty =
    report.totalExpense === '0.00' &&
    report.totalIncome === '0.00' &&
    report.categoryBreakdown.length === 0 &&
    report.dayByDayTrend.length === 0;
  if (isEmpty) {
    return null;
  }

  const header = localize(
    {
      uz: `🗓 Haftalik hisobot (${report.periodKey})`,
      ru: `🗓 Недельный отчёт (${report.periodKey})`,
      en: `🗓 Weekly report (${report.periodKey})`,
    },
    language,
  );

  return composeReport([
    header,
    [
      reportSpentLine(report.totalExpense, language),
      reportIncomeLine(report.totalIncome, language),
    ].join('\n'),
    reportPeriodicTrendSection(
      localize({ uz: 'Kunlar bo‘yicha', ru: 'По дням', en: 'By day' }, language),
      report.dayByDayTrend,
      language,
    ),
    reportCategoryBreakdownSection(report.categoryBreakdown, language),
    reportComparisonLine(
      { uz: 'Oldingi hafta', ru: 'Прошлая неделя', en: 'Prior week' },
      report.priorWeekComparison,
      language,
    ),
  ]);
}

export function renderMonthlyReport(
  report: MonthlyReport,
  language: DetectedLanguage,
): string | null {
  const isEmpty =
    report.totalExpense === '0.00' &&
    report.totalIncome === '0.00' &&
    report.categoryBreakdown.length === 0 &&
    report.topMerchants.length === 0 &&
    report.budgetPerformance.length === 0;
  if (isEmpty) {
    return null;
  }

  const header = localize(
    {
      uz: `📆 Oylik hisobot (${report.periodKey})`,
      ru: `📆 Месячный отчёт (${report.periodKey})`,
      en: `📆 Monthly report (${report.periodKey})`,
    },
    language,
  );
  const savedLine = `${localize({ uz: 'Jamg‘arildi', ru: 'Сэкономлено', en: 'Saved' }, language)}: ${report.totalSaved}`;

  const budgetSection =
    report.budgetPerformance.length === 0
      ? null
      : [
          localize(
            { uz: 'Byudjet bajarilishi', ru: 'Исполнение бюджета', en: 'Budget performance' },
            language,
          ),
          ...boundedLines(
            report.budgetPerformance,
            (b) => {
              const label =
                b.categoryId ?? localize({ uz: 'Umumiy', ru: 'Общий', en: 'Overall' }, language);
              const bar = reportProgressBar(b.utilizationPercent);
              return `${label}: ${bar} ${b.utilizationPercent.toFixed(1)}% (${b.usedAmount} / ${b.limitAmount})`;
            },
            language,
          ),
        ].join('\n');

  return composeReport([
    header,
    [
      reportSpentLine(report.totalExpense, language),
      reportIncomeLine(report.totalIncome, language),
      savedLine,
    ].join('\n'),
    reportCategoryBreakdownSection(report.categoryBreakdown, language),
    reportMerchantBreakdownSection(report.topMerchants, language),
    budgetSection,
    reportComparisonLine(
      { uz: 'Oldingi oy', ru: 'Прошлый месяц', en: 'Prior month' },
      report.priorMonthComparison,
      language,
    ),
  ]);
}

function reportProgressBar(utilizationPercent: number): string {
  const segments = 10;
  const filled = Math.max(0, Math.min(segments, Math.round((utilizationPercent / 100) * segments)));
  return '█'.repeat(filled) + '░'.repeat(segments - filled);
}

export function renderQuarterlyReport(
  report: QuarterlyReport,
  language: DetectedLanguage,
): string | null {
  const isEmpty =
    report.monthlyTrend.length === 0 &&
    report.categoryShift.current.length === 0 &&
    report.categoryShift.prior.length === 0;
  if (isEmpty) {
    return null;
  }

  const header = localize(
    {
      uz: `📊 Choraklik hisobot (${report.periodKey})`,
      ru: `📊 Квартальный отчёт (${report.periodKey})`,
      en: `📊 Quarterly report (${report.periodKey})`,
    },
    language,
  );

  const currentSection =
    report.categoryShift.current.length === 0
      ? null
      : [
          localize({ uz: 'Joriy chorak', ru: 'Текущий квартал', en: 'Current quarter' }, language),
          ...boundedLines(
            report.categoryShift.current,
            (c, i) => `${i + 1}. ${c.categoryId} — ${c.totalAmount}`,
            language,
          ),
        ].join('\n');

  const priorSection =
    report.categoryShift.prior.length === 0
      ? null
      : [
          localize({ uz: 'Oldingi chorak', ru: 'Прошлый квартал', en: 'Prior quarter' }, language),
          ...boundedLines(
            report.categoryShift.prior,
            (c, i) => `${i + 1}. ${c.categoryId} — ${c.totalAmount}`,
            language,
          ),
        ].join('\n');

  return composeReport([
    header,
    reportPeriodicTrendSection(
      localize({ uz: 'Oylar bo‘yicha', ru: 'По месяцам', en: 'By month' }, language),
      report.monthlyTrend,
      language,
    ),
    currentSection,
    priorSection,
  ]);
}

export function renderYearlyReport(
  report: YearlyReport,
  language: DetectedLanguage,
): string | null {
  const isEmpty =
    report.totalExpense === '0.00' &&
    report.totalIncome === '0.00' &&
    report.monthByMonthTrend.length === 0 &&
    report.categoryBreakdown.length === 0;
  if (isEmpty) {
    return null;
  }

  const header = localize(
    {
      uz: `📈 Yillik hisobot (${report.periodKey})`,
      ru: `📈 Годовой отчёт (${report.periodKey})`,
      en: `📈 Yearly report (${report.periodKey})`,
    },
    language,
  );

  return composeReport([
    header,
    [
      reportSpentLine(report.totalExpense, language),
      reportIncomeLine(report.totalIncome, language),
    ].join('\n'),
    reportPeriodicTrendSection(
      localize({ uz: 'Oylar bo‘yicha', ru: 'По месяцам', en: 'By month' }, language),
      report.monthByMonthTrend,
      language,
    ),
    reportCategoryBreakdownSection(report.categoryBreakdown, language),
    reportComparisonLine(
      { uz: 'O‘tgan yil', ru: 'Прошлый год', en: 'Year over year' },
      report.yearOverYearComparison,
      language,
    ),
  ]);
}

export function renderCashFlowReport(
  report: CashFlowReport,
  language: DetectedLanguage,
): string | null {
  const isEmpty =
    report.totalExpense === '0.00' &&
    report.totalIncome === '0.00' &&
    report.periodicTrend.length === 0;
  if (isEmpty) {
    return null;
  }

  const header = localize(
    {
      uz: `💵 Pul oqimi hisoboti (${formatReportDateRange(report.range)})`,
      ru: `💵 Отчёт о денежном потоке (${formatReportDateRange(report.range)})`,
      en: `💵 Cash flow report (${formatReportDateRange(report.range)})`,
    },
    language,
  );
  const netLine = `${localize({ uz: 'Sof pul oqimi', ru: 'Чистый денежный поток', en: 'Net cash flow' }, language)}: ${report.netCashFlow}`;
  const fullLine =
    report.fullCashFlow === null
      ? null
      : `${localize({ uz: 'To‘liq pul oqimi', ru: 'Полный денежный поток', en: 'Full cash flow' }, language)}: ${report.fullCashFlow}`;

  return composeReport([
    header,
    [
      reportSpentLine(report.totalExpense, language),
      reportIncomeLine(report.totalIncome, language),
      netLine,
    ].join('\n'),
    fullLine,
    reportPeriodicTrendSection(
      localize({ uz: 'Oylar bo‘yicha', ru: 'По месяцам', en: 'By month' }, language),
      report.periodicTrend,
      language,
    ),
  ]);
}

function reportDebtDirectionLabel(
  direction: 'given' | 'received',
  language: DetectedLanguage,
): string {
  return direction === 'given'
    ? localize({ uz: 'Berilgan', ru: 'Дано в долг', en: 'Given' }, language)
    : localize({ uz: 'Olingan', ru: 'Взято в долг', en: 'Received' }, language);
}

function reportOpenDebtLine(entry: OpenDebtSummaryEntry, language: DetectedLanguage): string {
  const due =
    entry.dueDate === null
      ? ''
      : ` (${localize({ uz: 'muddat', ru: 'срок', en: 'due' }, language)}: ${formatReportDate(entry.dueDate)}${entry.overdueDays !== null ? `, ${localize({ uz: 'kechikdi', ru: 'просрочено', en: 'overdue' }, language)} ${entry.overdueDays}d` : ''})`;
  return `${entry.counterpartyName}: ${entry.outstandingBalance} ${entry.currency}${due}`;
}

function reportSettledDebtLine(entry: SettledDebtSummaryEntry, language: DetectedLanguage): string {
  const statusLabel =
    entry.status === 'repaid'
      ? localize({ uz: 'to‘landi', ru: 'погашен', en: 'repaid' }, language)
      : localize({ uz: 'kechirildi', ru: 'прощён', en: 'forgiven' }, language);
  return `${entry.counterpartyName}: ${entry.originalAmount} ${entry.currency} (${statusLabel}, ${formatReportDate(entry.settledAt)})`;
}

export function renderDebtSummaryReport(
  report: DebtSummaryReport,
  language: DetectedLanguage,
): string | null {
  const isEmpty =
    report.openDebtsGiven.length === 0 &&
    report.openDebtsReceived.length === 0 &&
    report.settledDebts.length === 0;
  if (isEmpty) {
    return null;
  }

  const header = localize(
    { uz: '🤝 Qarzlar hisoboti', ru: '🤝 Отчёт по долгам', en: '🤝 Debt summary' },
    language,
  );

  const givenSection =
    report.openDebtsGiven.length === 0
      ? null
      : [
          reportDebtDirectionLabel('given', language),
          ...boundedLines(report.openDebtsGiven, (e) => reportOpenDebtLine(e, language), language),
        ].join('\n');

  const receivedSection =
    report.openDebtsReceived.length === 0
      ? null
      : [
          reportDebtDirectionLabel('received', language),
          ...boundedLines(
            report.openDebtsReceived,
            (e) => reportOpenDebtLine(e, language),
            language,
          ),
        ].join('\n');

  const settledSection =
    report.settledDebts.length === 0
      ? null
      : [
          localize({ uz: 'Yopilgan qarzlar', ru: 'Закрытые долги', en: 'Settled debts' }, language),
          ...boundedLines(report.settledDebts, (e) => reportSettledDebtLine(e, language), language),
        ].join('\n');

  return composeReport([header, givenSection, receivedSection, settledSection]);
}

function reportLargestTransactionsSection(
  transactions: readonly ReportTransactionSummary[],
  language: DetectedLanguage,
): string | null {
  if (transactions.length === 0) {
    return null;
  }
  const header = localize(
    { uz: 'Eng katta tranzaksiyalar', ru: 'Крупнейшие транзакции', en: 'Largest transactions' },
    language,
  );
  const lines = boundedLines(
    transactions,
    (t, i) =>
      `${i + 1}. ${t.description || t.merchant || t.categoryId} — ${t.amount} (${formatReportDate(t.transactionDate)})`,
    language,
  );
  return [header, ...lines].join('\n');
}

export function renderCategoryReport(
  report: CategoryReport,
  language: DetectedLanguage,
): string | null {
  const isEmpty =
    report.trend.length === 0 &&
    report.merchantBreakdown.length === 0 &&
    report.largestTransactions.length === 0;
  if (isEmpty) {
    return null;
  }

  const header = localize(
    {
      uz: `🏷 Kategoriya hisoboti: ${report.categoryId} (${formatReportDateRange(report.range)})`,
      ru: `🏷 Отчёт по категории: ${report.categoryId} (${formatReportDateRange(report.range)})`,
      en: `🏷 Category report: ${report.categoryId} (${formatReportDateRange(report.range)})`,
    },
    language,
  );

  return composeReport([
    header,
    reportPeriodicTrendSection(
      localize({ uz: 'Oylar bo‘yicha', ru: 'По месяцам', en: 'By month' }, language),
      report.trend,
      language,
    ),
    reportMerchantBreakdownSection(report.merchantBreakdown, language),
    reportLargestTransactionsSection(report.largestTransactions, language),
  ]);
}

export function renderMerchantReport(
  report: MerchantReport,
  language: DetectedLanguage,
): string | null {
  if (report.transactionCount === 0) {
    return null;
  }

  const header = localize(
    {
      uz: `🏪 Do‘kon hisoboti: ${report.merchant} (${formatReportDateRange(report.range)})`,
      ru: `🏪 Отчёт по магазину: ${report.merchant} (${formatReportDateRange(report.range)})`,
      en: `🏪 Merchant report: ${report.merchant} (${formatReportDateRange(report.range)})`,
    },
    language,
  );
  const totalsLine = `${reportSpentLine(report.totalAmount, language)} (${report.transactionCount})`;

  return composeReport([
    header,
    totalsLine,
    reportPeriodicTrendSection(
      localize({ uz: 'Oylar bo‘yicha', ru: 'По месяцам', en: 'By month' }, language),
      report.trend,
      language,
    ),
  ]);
}

export function renderCustomRangeReport(
  report: CustomRangeReport,
  language: DetectedLanguage,
): string | null {
  const isEmpty =
    report.totalExpense === '0.00' &&
    report.totalIncome === '0.00' &&
    report.categoryBreakdown.length === 0 &&
    report.merchantBreakdown.length === 0;
  if (isEmpty) {
    return null;
  }

  const header = localize(
    {
      uz: `🔢 Davr hisoboti (${formatReportDateRange(report.range)})`,
      ru: `🔢 Отчёт за период (${formatReportDateRange(report.range)})`,
      en: `🔢 Custom range report (${formatReportDateRange(report.range)})`,
    },
    language,
  );

  return composeReport([
    header,
    [
      reportSpentLine(report.totalExpense, language),
      reportIncomeLine(report.totalIncome, language),
    ].join('\n'),
    reportCategoryBreakdownSection(report.categoryBreakdown, language),
    reportMerchantBreakdownSection(report.merchantBreakdown, language),
  ]);
}

function reportTrajectoryLine(entry: CategoryTrajectory, language: DetectedLanguage): string {
  const directionLabel =
    entry.direction === 'increasing'
      ? localize({ uz: 'oshmoqda', ru: 'растёт', en: 'increasing' }, language)
      : entry.direction === 'decreasing'
        ? localize({ uz: 'kamaymoqda', ru: 'снижается', en: 'decreasing' }, language)
        : localize({ uz: 'barqaror', ru: 'стабильно', en: 'flat' }, language);
  return `${entry.categoryId}: ${directionLabel} (${entry.firstHalfTotal} → ${entry.secondHalfTotal})`;
}

export function renderTrendAnalysisReport(
  report: TrendAnalysisReport,
  language: DetectedLanguage,
): string | null {
  const isEmpty = report.monthlyTrend.length === 0 && report.categoryTrajectory.length === 0;
  if (isEmpty) {
    return null;
  }

  const header = localize(
    {
      uz: `📉 Trend tahlili (${formatReportDateRange(report.range)})`,
      ru: `📉 Анализ трендов (${formatReportDateRange(report.range)})`,
      en: `📉 Trend analysis (${formatReportDateRange(report.range)})`,
    },
    language,
  );

  const trajectorySection =
    report.categoryTrajectory.length === 0
      ? null
      : [
          localize(
            {
              uz: 'Kategoriya tendensiyasi',
              ru: 'Тенденция по категориям',
              en: 'Category trajectory',
            },
            language,
          ),
          ...boundedLines(
            report.categoryTrajectory,
            (e) => reportTrajectoryLine(e, language),
            language,
          ),
        ].join('\n');

  return composeReport([
    header,
    reportPeriodicTrendSection(
      localize({ uz: 'Oylar bo‘yicha', ru: 'По месяцам', en: 'By month' }, language),
      report.monthlyTrend,
      language,
    ),
    trajectorySection,
  ]);
}

/** Telegram's hard 4096-character-per-message limit (rule: never send an oversized message, no existing helper for this in the codebase yet — a new, minimal one). Splits on blank-line section boundaries first (never mid-section when avoidable); a single section longer than the limit is hard-sliced as a last resort. */
export function splitTelegramMessage(text: string, maxLength = 4096): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const sections = text.split('\n\n');
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };

  for (const section of sections) {
    const candidate = current.length === 0 ? section : `${current}\n\n${section}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    flush();
    if (section.length <= maxLength) {
      current = section;
    } else {
      for (let i = 0; i < section.length; i += maxLength) {
        chunks.push(section.slice(i, i + maxLength));
      }
    }
  }
  flush();

  return chunks;
}

// ============================================================================
// /export Telegram wiring — TASK-FIN-014 (Chapter 10 §10.2, FR-EXP2-001)
// ============================================================================

export function exportMenuReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: '📤 Qaysi davr uchun eksport qilamiz?',
      ru: '📤 За какой период экспортировать?',
      en: '📤 Which period would you like to export?',
    },
    language,
  );
}

/** §10.2.7's own edge case — "no empty/broken file generated," a friendly message instead. */
export function exportEmptyReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bu davr uchun eksport qilinadigan tranzaksiya topilmadi.',
      ru: 'За этот период нет транзакций для экспорта.',
      en: 'No transactions found for that period to export.',
    },
    language,
  );
}

/** FR-EXP2-003's own synchronous-generation threshold (5,000 rows) exceeded — this task's own scope decision keeps delivery synchronous-only (no async job/signed URL), so a narrower range is the only path forward for now. */
export function exportTooLargeReply(rowCount: number, language: DetectedLanguage): string {
  return localize(
    {
      uz: `Bu davrda ${rowCount} ta tranzaksiya bor — bu hozircha bitta faylga eksport qilish uchun juda ko'p. Qisqaroq davrni tanlang.`,
      ru: `За этот период ${rowCount} транзакций — это слишком много для экспорта в один файл сейчас. Выберите более короткий период.`,
      en: `That period has ${rowCount} transactions — too many to export in one file right now. Please choose a shorter period.`,
    },
    language,
  );
}

/** Never leaks internal error details/stack traces — the sole safe reply for any export failure. */
export function exportErrorReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Eksport faylini tayyorlab bo'lmadi. Birozdan so'ng qayta urinib ko'ring.",
      ru: 'Не удалось подготовить файл экспорта. Попробуйте ещё раз чуть позже.',
      en: "Couldn't generate that export. Please try again shortly.",
    },
    language,
  );
}

export function exportReadyCaption(rowCount: number, language: DetectedLanguage): string {
  return localize(
    {
      uz: `✅ Tayyor — ${rowCount} ta tranzaksiya.`,
      ru: `✅ Готово — ${rowCount} транзакций.`,
      en: `✅ Ready — ${rowCount} transactions.`,
    },
    language,
  );
}

// ============================================================================
// /settings Telegram wiring — Chapter 7 §7.3 Profile / §7.4 Settings
// ============================================================================

const LANGUAGE_DISPLAY_NAME: Record<DetectedLanguage, string> = {
  uz: "O'zbekcha",
  ru: 'Русский',
  en: 'English',
};

/** FR-PROF-001 — "view their current profile settings via /settings." */
export function settingsMenuReply(user: User, language: DetectedLanguage): string {
  const header = localize({ uz: '⚙️ Sozlamalar', ru: '⚙️ Настройки', en: '⚙️ Settings' }, language);
  const languageLine = `${localize({ uz: 'Til', ru: 'Язык', en: 'Language' }, language)}: ${LANGUAGE_DISPLAY_NAME[user.preferredLanguage as DetectedLanguage] ?? user.preferredLanguage}`;
  const currencyLine = `${localize({ uz: 'Valyuta', ru: 'Валюта', en: 'Currency' }, language)}: ${user.defaultCurrency}`;
  const timezoneLine = `${localize({ uz: 'Vaqt zonasi', ru: 'Часовой пояс', en: 'Timezone' }, language)}: ${user.timezone}`;
  return [header, languageLine, currencyLine, timezoneLine].join('\n');
}

export function settingsLanguagePromptReply(language: DetectedLanguage): string {
  return localize(
    { uz: 'Tilni tanlang:', ru: 'Выберите язык:', en: 'Choose a language:' },
    language,
  );
}

export function settingsCurrencyPromptReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Standart valyutani tanlang:',
      ru: 'Выберите валюту по умолчанию:',
      en: 'Choose your default currency:',
    },
    language,
  );
}

export function settingsTimezonePromptReply(language: DetectedLanguage): string {
  return localize(
    { uz: 'Vaqt zonasini tanlang:', ru: 'Выберите часовой пояс:', en: 'Choose your timezone:' },
    language,
  );
}

export function settingsNotificationsPromptReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Qaysi bildirishnomalarni olishni xohlaysiz?',
      ru: 'Какие уведомления вы хотите получать?',
      en: 'Which notifications would you like to receive?',
    },
    language,
  );
}

export function settingsConfidencePromptReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Past ishonchli maydonlarda "aniqlangan" belgisini ko‘rsatishni xohlaysizmi?',
      ru: 'Показывать индикатор "автоопределено" для полей с низкой уверенностью?',
      en: 'Show the "auto-detected" flag on low-confidence fields?',
    },
    language,
  );
}

const SETTINGS_FIELD_LABEL: Record<UpdateUserProfileField, Record<DetectedLanguage, string>> = {
  language: { uz: 'Til', ru: 'Язык', en: 'Language' },
  currency: { uz: 'Valyuta', ru: 'Валюта', en: 'Currency' },
  timezone: { uz: 'Vaqt zonasi', ru: 'Часовой пояс', en: 'Timezone' },
};

/** FR-SET-004 — "Settings changes must be confirmed back to the user explicitly... never a silent state change." */
export function settingsProfileUpdatedReply(
  field: UpdateUserProfileField,
  value: string,
  language: DetectedLanguage,
): string {
  const label = localize(SETTINGS_FIELD_LABEL[field], language);
  const displayValue =
    field === 'language' ? (LANGUAGE_DISPLAY_NAME[value as DetectedLanguage] ?? value) : value;
  return localize(
    {
      uz: `✅ ${label} ${displayValue} qilib o'rnatildi.`,
      ru: `✅ ${label}: установлено значение ${displayValue}.`,
      en: `✅ ${label} set to ${displayValue}.`,
    },
    language,
  );
}

export function settingsInvalidValueReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bu qiymat qo'llab-quvvatlanmaydi.",
      ru: 'Это значение не поддерживается.',
      en: 'That value is not supported.',
    },
    language,
  );
}

const NOTIFICATION_TOGGLE_LABEL: Record<
  'debt_reminder' | 'budget_alert',
  Record<DetectedLanguage, string>
> = {
  debt_reminder: { uz: 'Qarz eslatmalari', ru: 'Напоминания о долгах', en: 'Debt reminders' },
  budget_alert: {
    uz: 'Byudjet ogohlantirishlari',
    ru: 'Оповещения о бюджете',
    en: 'Budget alerts',
  },
};

export function settingsNotificationToggledReply(
  toggle: 'debt_reminder' | 'budget_alert',
  enabled: boolean,
  language: DetectedLanguage,
): string {
  const label = localize(NOTIFICATION_TOGGLE_LABEL[toggle], language);
  const state = enabled
    ? localize({ uz: 'yoqildi', ru: 'включены', en: 'enabled' }, language)
    : localize({ uz: "o'chirildi", ru: 'отключены', en: 'disabled' }, language);
  return `✅ ${label}: ${state}.`;
}

export function settingsConfidenceToggledReply(
  enabled: boolean,
  language: DetectedLanguage,
): string {
  const state = enabled
    ? localize({ uz: 'yoqildi', ru: 'включён', en: 'enabled' }, language)
    : localize({ uz: "o'chirildi", ru: 'отключён', en: 'disabled' }, language);
  return `✅ ${localize({ uz: 'Ishonch belgisi', ru: 'Индикатор доверия', en: 'Confidence flag' }, language)}: ${state}.`;
}

/** Never leaks internal error details/stack traces — the sole safe reply for any /settings failure. */
export function settingsErrorReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Sozlamani saqlab bo'lmadi. Birozdan so'ng qayta urinib ko'ring.",
      ru: 'Не удалось сохранить настройку. Попробуйте ещё раз чуть позже.',
      en: "Couldn't save that setting. Please try again shortly.",
    },
    language,
  );
}

// ============================================================================
// TASK-FIN-013 — /undo (Chapter 10 §10.4)
// ============================================================================

/**
 * Same "amount currency — category — merchant" shape as `formatSearchResultLine`
 * (the codebase's own established convention for identifying a real, already-
 * committed transaction in a reply) — date rendered as an ISO calendar date,
 * matching search results, rather than a relative "3 days ago" phrase: no
 * relative-time formatter exists anywhere else in this codebase, and inventing
 * one for this single call site would be new, undocumented behavior.
 */
function formatUndoneTransactionLine(transaction: {
  amount: string;
  currency: string;
  categoryId: string;
  merchant: string | null;
  transactionDate: Date;
}): string {
  const date = transaction.transactionDate.toISOString().slice(0, 10);
  const merchantPart = transaction.merchant ? ` — ${transaction.merchant}` : '';
  return `${transaction.amount} ${transaction.currency} — ${transaction.categoryId}${merchantPart} — ${date}`;
}

/** FR-UND-001, last action = delete → reversed via restore. */
export function undoRestoredReply(
  transaction: {
    amount: string;
    currency: string;
    categoryId: string;
    merchant: string | null;
    transactionDate: Date;
  },
  language: DetectedLanguage,
): string {
  const label = localize({ uz: 'Tiklandi', ru: 'Восстановлено', en: 'Restored' }, language);
  return `↩️ ${localize({ uz: 'Bekor qilindi', ru: 'Отменено', en: 'Undone' }, language)} — ${label}: ${formatUndoneTransactionLine(transaction)}`;
}

/** FR-UND-001, last action = create (never edited since) → reversed via delete. */
export function undoRemovedReply(
  transaction: {
    amount: string;
    currency: string;
    categoryId: string;
    merchant: string | null;
    transactionDate: Date;
  },
  language: DetectedLanguage,
): string {
  const label = localize({ uz: "O'chirildi", ru: 'Удалено', en: 'Removed' }, language);
  return `↩️ ${localize({ uz: 'Bekor qilindi', ru: 'Отменено', en: 'Undone' }, language)} — ${label}: ${formatUndoneTransactionLine(transaction)}`;
}

/** FR-UND-001 edge case — the user has no transaction history to undo at all. */
export function undoNothingToUndoReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bekor qiladigan hech narsa yo'q.",
      ru: 'Нечего отменять.',
      en: 'Nothing to undo.',
    },
    language,
  );
}

/**
 * Last action was an edit — this codebase has no backend to revert a prior
 * field value (the audit log is write-only, see TASK-FIN-013's own final
 * report), so this is disclosed to the user rather than silently deleting
 * a legitimately-edited transaction.
 */
export function undoUnsupportedActionReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Oxirgi amalni bekor qilib bo'lmadi — tahrirlarni hozircha bekor qilib bo'lmaydi.",
      ru: 'Не удалось отменить последнее действие — отмена редактирования пока не поддерживается.',
      en: "Couldn't undo the last action — undoing an edit isn't supported yet.",
    },
    language,
  );
}

/** Never leaks internal error details/stack traces — the sole safe reply for any /undo failure. */
export function undoErrorReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Bekor qilib bo'lmadi. Birozdan so'ng qayta urinib ko'ring.",
      ru: 'Не удалось отменить. Попробуйте ещё раз чуть позже.',
      en: "Couldn't undo that. Please try again shortly.",
    },
    language,
  );
}

// ============================================================================
// TASK-FIN-006 — Custom Categories (Chapter 7 §7.4, Chapter 8 §8.11)
// ============================================================================

/** US-SET-003/FR-FIN-019 — an empty list is a friendly note, not a bare empty menu. */
export function customCategoriesListReply(
  categoryCount: number,
  language: DetectedLanguage,
): string {
  const header = localize(
    { uz: '🏷 Maxsus kategoriyalar', ru: '🏷 Свои категории', en: '🏷 Custom categories' },
    language,
  );
  if (categoryCount === 0) {
    return `${header}\n\n${localize(
      {
        uz: "Hali maxsus kategoriyalaringiz yo'q.",
        ru: 'У вас пока нет своих категорий.',
        en: "You don't have any custom categories yet.",
      },
      language,
    )}`;
  }
  return header;
}

export function customCategoryNamePromptReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Yangi kategoriya uchun nom kiriting:',
      ru: 'Введите название новой категории:',
      en: 'Type a name for your new category:',
    },
    language,
  );
}

/** FR-SET-003 — checked before saving, case/language-insensitively against both system and existing custom category names. */
export function customCategoryDuplicateNameReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Bu nomdagi kategoriya allaqachon mavjud. Boshqa nom kiriting:',
      ru: 'Категория с таким названием уже существует. Введите другое название:',
      en: 'A category with that name already exists. Try a different name:',
    },
    language,
  );
}

/** `CustomCategory.validateName` rejects empty/whitespace-only/too-long — never leaks the raw domain error message. */
export function customCategoryInvalidNameReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Noto'g'ri nom. Bo'sh bo'lmagan, 60 belgidan qisqa nom kiriting:",
      ru: 'Некорректное название. Введите непустое название до 60 символов:',
      en: 'Invalid name. Enter a non-empty name under 60 characters:',
    },
    language,
  );
}

/** §7.9.6 step 4 — "system prompts for a parent system category (BR-SET-001 requires one)." */
export function customCategoryParentPromptReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: 'Ota-kategoriyani tanlang:',
      ru: 'Выберите родительскую категорию:',
      en: 'Choose a parent category:',
    },
    language,
  );
}

/** A forged/stale `settings_categories_parent:<code>` callback — generic safe response, never leaks that the code was recognized-but-inactive vs. entirely fake. */
export function customCategoryInvalidParentReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Noto'g'ri ota-kategoriya. Qaytadan urinib ko'ring.",
      ru: 'Некорректная родительская категория. Попробуйте ещё раз.',
      en: 'Invalid parent category. Please try again.',
    },
    language,
  );
}

/** FR-SET-004 — "Settings changes must be confirmed back to the user explicitly." */
export function customCategoryCreatedReply(
  name: string,
  parentLabel: string,
  language: DetectedLanguage,
): string {
  return localize(
    {
      uz: `✅ "${name}" kategoriyasi yaratildi (ota-kategoriya: ${parentLabel}).`,
      ru: `✅ Категория «${name}» создана (родительская категория: ${parentLabel}).`,
      en: `✅ "${name}" category created (parent: ${parentLabel}).`,
    },
    language,
  );
}

/**
 * §7.4.7/§11.7.6-mirrored delete preview — "the user is shown exactly which
 * transactions were affected before the deletion is finalized."
 */
export function customCategoryDeletePreviewReply(
  name: string,
  parentLabel: string,
  affectedTransactionCount: number,
  language: DetectedLanguage,
): string {
  const warning =
    affectedTransactionCount > 0
      ? localize(
          {
            uz: `${affectedTransactionCount} ta tranzaksiya "${parentLabel}" kategoriyasiga ko'chiriladi.`,
            ru: `${affectedTransactionCount} транзакций будет перенесено в категорию «${parentLabel}».`,
            en: `${affectedTransactionCount} transaction(s) will be re-tagged to "${parentLabel}".`,
          },
          language,
        )
      : localize(
          {
            uz: 'Bu kategoriyaga tegishli tranzaksiyalar yo\'q.',
            ru: 'С этой категорией не связано ни одной транзакции.',
            en: 'No transactions are tagged with this category.',
          },
          language,
        );
  const question = localize(
    { uz: `"${name}"ni o'chirasizmi?`, ru: `Удалить «${name}»?`, en: `Delete "${name}"?` },
    language,
  );
  return `${warning}\n\n${question}`;
}

export function customCategoryDeletedReply(
  parentLabel: string,
  reassignedTransactionCount: number,
  language: DetectedLanguage,
): string {
  const retagLine =
    reassignedTransactionCount > 0
      ? localize(
          {
            uz: `${reassignedTransactionCount} ta tranzaksiya "${parentLabel}"ga ko'chirildi.`,
            ru: `${reassignedTransactionCount} транзакций перенесено в «${parentLabel}».`,
            en: `${reassignedTransactionCount} transaction(s) re-tagged to "${parentLabel}".`,
          },
          language,
        )
      : '';
  const header = localize(
    { uz: "✅ Kategoriya o'chirildi.", ru: '✅ Категория удалена.', en: '✅ Category deleted.' },
    language,
  );
  return retagLine ? `${header} ${retagLine}` : header;
}

/** A forged/stale `settings_categories_delete*:<id>` callback, or a category already deleted by an earlier/concurrent tap — generic safe response, never distinguishes the two. */
export function customCategoryNotFoundReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Kategoriya topilmadi. U allaqachon o'chirilgan bo'lishi mumkin.",
      ru: 'Категория не найдена. Возможно, она уже удалена.',
      en: "Category not found. It may have already been deleted.",
    },
    language,
  );
}

/** Never leaks internal error details/stack traces — the sole safe reply for any Custom Categories failure. */
export function customCategoryErrorReply(language: DetectedLanguage): string {
  return localize(
    {
      uz: "Amalni bajarib bo'lmadi. Birozdan so'ng qayta urinib ko'ring.",
      ru: 'Не удалось выполнить действие. Попробуйте ещё раз чуть позже.',
      en: "Couldn't complete that action. Please try again shortly.",
    },
    language,
  );
}
