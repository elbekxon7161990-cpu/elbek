import { SchemaValidationError } from '../errors/schema-validation.error';
import type { SchemaValidationIssue } from '../errors/schema-validation.error';
import type { PaymentMethod } from '../entities/transaction.entity';
import { PAYMENT_METHODS, normalizePaymentMethod } from './normalize-payment-method';
import { normalizeTransactionTime } from './normalize-transaction-time';
import {
  AI_INTENTS,
  CATEGORY_REQUIRED_INTENTS,
  COUNTERPARTY_REQUIRED_INTENTS,
  DETECTED_LANGUAGES,
  FINANCIAL_INTENTS,
} from './transaction-extraction-schema';
import type {
  AiIntent,
  DetectedLanguage,
  ExtractionConfidenceScores,
  StructuredExtractionOutput,
  TransactionExtractionCandidate,
} from './transaction-extraction-schema';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const CANDIDATE_KEYS = [
  'intent',
  'amount',
  'currency',
  'category',
  'subcategory',
  'merchant',
  'paymentMethod',
  'transactionDate',
  'transactionTime',
  'location',
  'counterparty',
  'dueDate',
  'tags',
  'description',
  'confidenceScores',
] as const;

const ENVELOPE_KEYS = [
  'transactions',
  'detectedLanguage',
  'clarificationNeeded',
  'clarificationQuestion',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function checkUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: SchemaValidationIssue[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      issues.push({
        path: path ? `${path}.${key}` : key,
        message: `Unknown field "${key}" is not permitted by the schema.`,
      });
    }
  }
}

function validateNullableString(
  value: unknown,
  path: string,
  issues: SchemaValidationIssue[],
): void {
  if (value !== null && typeof value !== 'string') {
    issues.push({ path, message: `Expected a string or null, got ${typeof value}.` });
  }
}

function validateConfidenceScores(
  value: unknown,
  path: string,
  issues: SchemaValidationIssue[],
): ExtractionConfidenceScores {
  if (!isPlainObject(value)) {
    issues.push({
      path,
      message: `Expected an object, got ${Array.isArray(value) ? 'array' : typeof value}.`,
    });
    return {};
  }
  const scores: ExtractionConfidenceScores = {};
  for (const [field, score] of Object.entries(value)) {
    if (typeof score !== 'number' || Number.isNaN(score) || !Number.isFinite(score)) {
      issues.push({
        path: `${path}.${field}`,
        message: `Confidence score must be a finite number, got ${JSON.stringify(score)}.`,
      });
      continue;
    }
    if (score < 0 || score > 1) {
      issues.push({
        path: `${path}.${field}`,
        message: `Confidence score must be within [0.0, 1.0] (§4.6.1), got ${score}.`,
      });
      continue;
    }
    scores[field] = score;
  }
  return scores;
}

function validateCandidate(
  raw: unknown,
  index: number,
  issues: SchemaValidationIssue[],
): TransactionExtractionCandidate | null {
  const path = `transactions[${index}]`;
  if (!isPlainObject(raw)) {
    issues.push({
      path,
      message: `Expected an object, got ${Array.isArray(raw) ? 'array' : typeof raw}.`,
    });
    return null;
  }
  checkUnknownKeys(raw, CANDIDATE_KEYS, path, issues);

  const intentRaw = raw.intent;
  const intent: AiIntent | null =
    typeof intentRaw === 'string' && (AI_INTENTS as readonly string[]).includes(intentRaw)
      ? (intentRaw as AiIntent)
      : null;
  if (intent === null) {
    issues.push({
      path: `${path}.intent`,
      message: `Expected one of the taxonomy §4.3.1 intents, got ${JSON.stringify(intentRaw)}.`,
    });
  }

  const isFinancial = intent !== null && FINANCIAL_INTENTS.includes(intent);
  const isCounterpartyRequired = intent !== null && COUNTERPARTY_REQUIRED_INTENTS.includes(intent);
  const isCategoryRequired = intent !== null && CATEGORY_REQUIRED_INTENTS.includes(intent);

  // amount — structural validity only (finite number or null); positivity
  // (`amount > 0`) is Chapter 8's Domain Service validation (§4.10), not
  // this schema's concern — duplicating it here would blur that boundary.
  const amountRaw = raw.amount;
  let amount: number | null = null;
  if (amountRaw === null) {
    if (isFinancial) {
      issues.push({
        path: `${path}.amount`,
        message: `"amount" is required for financial intent "${intent}" (§4.4.1).`,
      });
    }
  } else if (
    typeof amountRaw !== 'number' ||
    Number.isNaN(amountRaw) ||
    !Number.isFinite(amountRaw)
  ) {
    issues.push({
      path: `${path}.amount`,
      message: `Expected a finite number or null, got ${JSON.stringify(amountRaw)}.`,
    });
  } else if (!isFinancial) {
    issues.push({
      path: `${path}.amount`,
      message: `"amount" must be null for non-financial intent "${String(intent)}".`,
    });
  } else {
    amount = amountRaw;
  }

  const currencyRaw = raw.currency;
  let currency: string | null = null;
  if (currencyRaw === null) {
    if (isFinancial) {
      issues.push({
        path: `${path}.currency`,
        message: `"currency" is required for financial intent "${intent}" (§4.4.1).`,
      });
    }
  } else if (typeof currencyRaw !== 'string' || !/^[A-Z]{3}$/.test(currencyRaw)) {
    issues.push({
      path: `${path}.currency`,
      message: `Expected a 3-letter ISO 4217 code or null, got ${JSON.stringify(currencyRaw)}.`,
    });
  } else {
    currency = currencyRaw;
  }

  const categoryRaw = raw.category;
  let category: string | null = null;
  validateNullableString(categoryRaw, `${path}.category`, issues);
  if (typeof categoryRaw === 'string') {
    category = categoryRaw;
  }
  if (isCategoryRequired && (categoryRaw === null || categoryRaw === '')) {
    issues.push({
      path: `${path}.category`,
      message: `"category" is required for intent "${intent}" (§4.4.1: "Yes for EXPENSE/INCOME").`,
    });
  }

  validateNullableString(raw.subcategory, `${path}.subcategory`, issues);
  const subcategory = typeof raw.subcategory === 'string' ? raw.subcategory : null;

  validateNullableString(raw.merchant, `${path}.merchant`, issues);
  const merchant = typeof raw.merchant === 'string' ? raw.merchant : null;

  const paymentMethodRaw = raw.paymentMethod;
  let paymentMethod: PaymentMethod | null = null;
  if (paymentMethodRaw !== null) {
    const normalizedPaymentMethod =
      typeof paymentMethodRaw === 'string' ? normalizePaymentMethod(paymentMethodRaw) : null;
    if (normalizedPaymentMethod === null) {
      issues.push({
        path: `${path}.paymentMethod`,
        message: `Expected one of ${PAYMENT_METHODS.join(', ')} or null, got ${JSON.stringify(paymentMethodRaw)}.`,
      });
    } else {
      paymentMethod = normalizedPaymentMethod;
    }
  }

  const transactionDateRaw = raw.transactionDate;
  let transactionDate: string | null = null;
  if (transactionDateRaw === null) {
    if (isFinancial) {
      issues.push({
        path: `${path}.transactionDate`,
        message: `"transactionDate" is required for financial intent "${intent}" (§4.4.1).`,
      });
    }
  } else if (typeof transactionDateRaw !== 'string' || !isValidCalendarDate(transactionDateRaw)) {
    issues.push({
      path: `${path}.transactionDate`,
      message: `Expected a valid "YYYY-MM-DD" calendar date or null, got ${JSON.stringify(transactionDateRaw)}.`,
    });
  } else {
    transactionDate = transactionDateRaw;
  }

  const transactionTimeRaw = raw.transactionTime;
  let transactionTime: string | null = null;
  if (transactionTimeRaw !== null) {
    const normalizedTime =
      typeof transactionTimeRaw === 'string' ? normalizeTransactionTime(transactionTimeRaw) : null;
    if (normalizedTime === null) {
      issues.push({
        path: `${path}.transactionTime`,
        message: `Expected a valid "HH:MM:SS" time or null, got ${JSON.stringify(transactionTimeRaw)}.`,
      });
    } else {
      transactionTime = normalizedTime;
    }
  }

  validateNullableString(raw.location, `${path}.location`, issues);
  const location = typeof raw.location === 'string' ? raw.location : null;

  const counterpartyRaw = raw.counterparty;
  let counterparty: string | null = null;
  validateNullableString(counterpartyRaw, `${path}.counterparty`, issues);
  if (typeof counterpartyRaw === 'string') {
    counterparty = counterpartyRaw;
  }
  if (isCounterpartyRequired && (counterpartyRaw === null || counterpartyRaw === '')) {
    issues.push({
      path: `${path}.counterparty`,
      message: `"counterparty" is required for intent "${intent}" (§4.4.1: "Required for DEBT_* / TRANSFER intents").`,
    });
  }

  const dueDateRaw = raw.dueDate;
  let dueDate: string | null = null;
  if (dueDateRaw !== null) {
    if (typeof dueDateRaw !== 'string' || !isValidCalendarDate(dueDateRaw)) {
      issues.push({
        path: `${path}.dueDate`,
        message: `Expected a valid "YYYY-MM-DD" calendar date or null, got ${JSON.stringify(dueDateRaw)}.`,
      });
    } else {
      dueDate = dueDateRaw;
    }
  }

  const tagsRaw = raw.tags;
  let tags: string[] = [];
  if (!Array.isArray(tagsRaw) || tagsRaw.some((tag) => typeof tag !== 'string')) {
    issues.push({
      path: `${path}.tags`,
      message: `Expected an array of strings, got ${JSON.stringify(tagsRaw)}.`,
    });
  } else {
    tags = tagsRaw;
  }

  const descriptionRaw = raw.description;
  let description = '';
  if (typeof descriptionRaw !== 'string' || descriptionRaw.trim().length === 0) {
    issues.push({
      path: `${path}.description`,
      message: `"description" is required and must be a non-empty string (§4.4.1).`,
    });
  } else {
    description = descriptionRaw;
  }

  const confidenceScores = validateConfidenceScores(
    raw.confidenceScores,
    `${path}.confidenceScores`,
    issues,
  );

  if (intent === null) {
    return null;
  }

  return {
    intent,
    amount,
    currency,
    category,
    subcategory,
    merchant,
    paymentMethod,
    transactionDate,
    transactionTime,
    location,
    counterparty,
    dueDate,
    tags,
    description,
    confidenceScores,
  };
}

/**
 * TASK-AI-001 — zero-tolerance structural validation of an already-parsed
 * LLM response against §4.4.1/§4.5.3's schema. Collects every issue found
 * (never stops at the first) and throws `SchemaValidationError` if any
 * exist; returns a fully-typed `StructuredExtractionOutput` only when the
 * entire payload is valid. Never repairs, coerces, or guesses a value —
 * an invalid payload is always rejected wholesale, per NFR-AI-003's "zero
 * tolerance" framing.
 */
export function validateStructuredExtractionOutput(raw: unknown): StructuredExtractionOutput {
  const issues: SchemaValidationIssue[] = [];

  if (!isPlainObject(raw)) {
    throw new SchemaValidationError([
      {
        path: '',
        message: `Expected an object, got ${Array.isArray(raw) ? 'array' : typeof raw}.`,
      },
    ]);
  }

  checkUnknownKeys(raw, ENVELOPE_KEYS, '', issues);

  const transactionsRaw = raw.transactions;
  const transactions: TransactionExtractionCandidate[] = [];
  if (!Array.isArray(transactionsRaw)) {
    issues.push({
      path: 'transactions',
      message: `Expected an array, got ${typeof transactionsRaw}.`,
    });
  } else {
    transactionsRaw.forEach((candidateRaw, index) => {
      const candidate = validateCandidate(candidateRaw, index, issues);
      if (candidate) {
        transactions.push(candidate);
      }
    });
  }

  const detectedLanguageRaw = raw.detectedLanguage;
  let detectedLanguage: DetectedLanguage = 'en';
  if (
    typeof detectedLanguageRaw !== 'string' ||
    !(DETECTED_LANGUAGES as readonly string[]).includes(detectedLanguageRaw)
  ) {
    issues.push({
      path: 'detectedLanguage',
      message: `Expected one of ${DETECTED_LANGUAGES.join(', ')}, got ${JSON.stringify(detectedLanguageRaw)}.`,
    });
  } else {
    detectedLanguage = detectedLanguageRaw as DetectedLanguage;
  }

  const clarificationNeededRaw = raw.clarificationNeeded;
  if (typeof clarificationNeededRaw !== 'boolean') {
    issues.push({
      path: 'clarificationNeeded',
      message: `Expected a boolean, got ${typeof clarificationNeededRaw}.`,
    });
  }

  const clarificationQuestionRaw = raw.clarificationQuestion;
  validateNullableString(clarificationQuestionRaw, 'clarificationQuestion', issues);

  // Cross-field constraint: a "clarification needed" signal with no
  // question is a contradictory/incomplete response, not a valid one.
  if (
    clarificationNeededRaw === true &&
    (clarificationQuestionRaw === null || clarificationQuestionRaw === '')
  ) {
    issues.push({
      path: 'clarificationQuestion',
      message:
        '"clarificationQuestion" must be a non-empty string when "clarificationNeeded" is true.',
    });
  }
  if (
    clarificationNeededRaw === false &&
    typeof clarificationQuestionRaw === 'string' &&
    clarificationQuestionRaw.length > 0
  ) {
    issues.push({
      path: 'clarificationQuestion',
      message: '"clarificationQuestion" must be null when "clarificationNeeded" is false.',
    });
  }

  if (issues.length > 0) {
    throw new SchemaValidationError(issues);
  }

  return {
    transactions,
    detectedLanguage,
    clarificationNeeded: clarificationNeededRaw === true,
    clarificationQuestion:
      typeof clarificationQuestionRaw === 'string' ? clarificationQuestionRaw : null,
  };
}
