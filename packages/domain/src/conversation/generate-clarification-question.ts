import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';

/**
 * TASK-BOT-003 (Chapter 5 §5.3.2 "Clarification Question Generation") —
 * deterministic, template-based question text for the single
 * highest-priority missing/uncertain field `selectClarificationField`
 * (§5.14) selected. Never an LLM call: FR-CE-001 requires questions to be
 * "specific and single-purpose", and this task's own instructions forbid
 * letting an LLM invent wording for a safety-critical financial
 * clarification — a fixed template per (field, language, retry-tier) is
 * sufficient and strictly safer (no risk of the model injecting a
 * fabricated value, a wrong language, or an off-topic question).
 *
 * Two wording tiers only (`retryCount === 0` -> initial, `retryCount >= 1`
 * -> retry), matching NFR-CE-003's "2 round-trips before fallback": the
 * *third* attempt is FR-CE-005's fallback path, which is a generic
 * "let's try a different way" message (`CLARIFICATION_FALLBACK_REPLY` in
 * `apps/telegram-bot`), not a third question tier from this function —
 * per §5.3.5's own worked example, the fallback message stops asking the
 * same question a third time and instead announces a different approach
 * (a manual mini-form), which is UI scope this task does not build (no
 * inline-keyboard infrastructure exists yet for this flow).
 *
 * BR-CE-003's "re-asks once with a more specific prompt" is exactly the
 * retry tier's job — its wording is deliberately more concrete than the
 * initial ask (e.g. giving a worked example of the expected format), per
 * §5.3.5's worked example ("Could you tell me the amount involved?" ->
 * "I need a specific number to log this — how much, roughly? (e.g. '50000'
 * or '50k')").
 */

export type ClarificationRetryTier = 'initial' | 'retry';

function retryTierFor(retryCount: number): ClarificationRetryTier {
  return retryCount <= 0 ? 'initial' : 'retry';
}

type FieldTemplates = Record<DetectedLanguage, Record<ClarificationRetryTier, string>>;

/**
 * Every field this function has a real, PRD-groundable template for.
 * `merchant` has no entry in `computeRequiredFields`'s output (it is never
 * a *required* field — see `selectClarificationField`'s own doc comment),
 * so it can never actually be the blocking field returned by that
 * function under the current architecture; it is still templated here
 * (Chapter 5 §5.3.2's field list is intentionally broader than "required
 * for commit") so this generator can be called directly — and is
 * exercised directly, not through the live end-to-end pipeline — should a
 * future task make merchant confirmation blocking.
 */
const FIELD_TEMPLATES: Partial<Record<string, FieldTemplates>> = {
  amount: {
    uz: {
      initial: 'Qancha summa edi?',
      retry: 'Iltimos, aniq son yozing (masalan: 50000 yoki 50 ming) — qancha summa edi?',
    },
    ru: {
      initial: 'Какая сумма?',
      retry: 'Нужна точная сумма (например: 50000 или 50 тысяч) — сколько это было?',
    },
    en: {
      initial: 'How much was it?',
      retry: "I need a specific number to log this — how much, roughly? (e.g. '50000' or '50k')",
    },
  },
  currency: {
    uz: {
      initial: "Bu qaysi valyutada — so'mmi?",
      retry: "Valyutasini aniqroq yozing — masalan, so'm, dollar yoki rubl?",
    },
    ru: {
      initial: 'В какой валюте это было — в сумах?',
      retry: 'Уточните валюту, пожалуйста — сум, доллар или рубль?',
    },
    en: {
      initial: 'What currency was that in?',
      retry: 'Which currency — e.g. UZS, USD, or RUB?',
    },
  },
  transactionDate: {
    uz: {
      initial: 'Bu xarajat bugungi kun uchunmi?',
      retry: "Aniq sanasini yozing (masalan: bugun, kecha yoki 2026-08-14) — qachon bo'lgan edi?",
    },
    ru: {
      initial: 'Это было сегодня?',
      retry: 'Уточните дату (например: сегодня, вчера или 2026-08-14) — когда это произошло?',
    },
    en: {
      initial: 'Was this today?',
      retry:
        "I need a specific date (e.g. 'today', 'yesterday', or '2026-08-14') — when did this happen?",
    },
  },
  category: {
    uz: {
      initial: 'Bu xarajat qaysi toifaga kiradi?',
      retry: "Toifasini aniqroq yozing — masalan, oziq-ovqat, transport yoki kommunal to'lovlar?",
    },
    ru: {
      initial: 'К какой категории это относится?',
      retry: 'Уточните категорию — например, еда, транспорт или коммунальные услуги?',
    },
    en: {
      initial: 'What category does this fall under?',
      retry: 'Which category, more specifically — e.g. food, transport, or utilities?',
    },
  },
  counterparty: {
    uz: {
      initial: 'Kimga berdingiz (yoki kimdan oldingiz)?',
      retry: 'Ismini aniqroq yozing — bu kim edi?',
    },
    ru: {
      initial: 'Кому вы дали (или от кого получили)?',
      retry: 'Уточните имя — кто это был?',
    },
    en: {
      initial: 'Who was this with?',
      retry: 'I need a name to log this — who was it?',
    },
  },
  merchant: {
    uz: {
      initial: "Bu qayerda sodir bo'ldi (do'kon yoki xizmat nomi)?",
      retry: 'Nomini aniqroq yozing — qayerda edi?',
    },
    ru: {
      initial: 'Где это было (название магазина или сервиса)?',
      retry: 'Уточните название — где именно?',
    },
    en: {
      initial: 'Where was this (merchant or service name)?',
      retry: 'Which merchant, specifically?',
    },
  },
};

const INTENT_AMBIGUOUS_TEMPLATES: FieldTemplates = {
  uz: {
    initial: 'Buni aniqroq tushuntira olasizmi — bu xarajat, daromad yoki qarzmi?',
    retry:
      'Hali ham tushunmadim — iltimos, bu nima ekanini aniqroq yozing (masalan: xarajat, daromad yoki qarz).',
  },
  ru: {
    initial: 'Не могли бы вы уточнить — это расход, доход или долг?',
    retry: 'Я всё ещё не понял — уточните, пожалуйста, что это было (расход, доход или долг).',
  },
  en: {
    initial: 'Could you clarify — was this an expense, income, or a debt?',
    retry:
      'I still did not catch that — could you say more specifically what this was (expense, income, or debt)?',
  },
};

const UNSUPPORTED_FIELD_TEMPLATES: FieldTemplates = {
  uz: {
    initial: "Kechirasiz, buni to'liq tushunmadim — qayta, boshqacharoq yozib bera olasizmi?",
    retry: 'Hali ham tushunmadim — iltimos, xabaringizni butunlay qayta yozib yuboring.',
  },
  ru: {
    initial: 'Извините, я не совсем понял — не могли бы вы переформулировать?',
    retry: 'Я всё ещё не понял — пожалуйста, напишите сообщение заново, другими словами.',
  },
  en: {
    initial: 'Sorry, I did not fully understand that — could you rephrase?',
    retry: 'I still did not catch that — could you send the whole message again, differently?',
  },
};

export interface GenerateClarificationQuestionInput {
  /**
   * The single field `selectClarificationField` chose, or `null` for
   * intent ambiguity — same convention as `AwaitingClarificationContext.missingField`.
   */
  missingField: string | null;
  /** `StructuredExtractionOutput.detectedLanguage` (Chapter 4) — FR-CE-003's "user's detected/preferred language", reused, not re-detected. */
  language: DetectedLanguage;
  /** `AwaitingClarificationContext.retryCount` *before* this question is asked (0 for the first ask). */
  retryCount: number;
}

/**
 * Never falls through to an empty/undefined string: an unrecognized field
 * name (should never happen given `selectClarificationField` only returns
 * values `computeRequiredFields` produces, but defended here per AI-P6
 * "fail closed") gets `UNSUPPORTED_FIELD_TEMPLATES`'s honest
 * "I didn't understand" wording rather than a fabricated field-specific
 * question about a field this function has no real template for.
 */
export function generateClarificationQuestion(input: GenerateClarificationQuestionInput): string {
  const tier = retryTierFor(input.retryCount);

  if (input.missingField === null) {
    return INTENT_AMBIGUOUS_TEMPLATES[input.language][tier];
  }

  const templates = FIELD_TEMPLATES[input.missingField];
  if (!templates) {
    return UNSUPPORTED_FIELD_TEMPLATES[input.language][tier];
  }

  return templates[input.language][tier];
}

/**
 * FR-CE-005's fallback message (after NFR-CE-003's 2 retries are
 * exhausted) — a generic "let's try differently" acknowledgment per
 * §5.3.5's worked example, not a third question tier (see this module's
 * own doc comment). Still field-name-free and language-aware, unlike the
 * pre-TASK-BOT-003 hardcoded English-only, always-says-"amount" version it
 * replaces (`apps/telegram-bot`'s old `CLARIFICATION_FALLBACK_REPLY`).
 */
export function generateClarificationFallbackMessage(language: DetectedLanguage): string {
  switch (language) {
    case 'uz':
      return "Hechqisi yo'q — boshqacha yo'l bilan urinib ko'ramiz. Iltimos, butun xabaringizni qaytadan, imkon qadar aniqroq yozing.";
    case 'ru':
      return 'Ничего страшного — попробуем по-другому. Пожалуйста, напишите всё сообщение заново, как можно точнее.';
    case 'en':
    default:
      return "No problem — let's try a different way. Please resend the whole message, as specifically as you can.";
  }
}
