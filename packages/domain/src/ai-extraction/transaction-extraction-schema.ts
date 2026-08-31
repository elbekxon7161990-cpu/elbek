import type { PaymentMethod } from '../entities/transaction.entity';

/**
 * TASK-AI-001 (Chapter 4 §4.3.1's "Supported Intent Taxonomy" — the full,
 * 24-value list, verbatim). This is deliberately *not* the narrower
 * `TransactionType` TASK-FIN-001 defined (`EXPENSE`/`INCOME`/`SALARY`/
 * `REFUND`) — that type describes what the `transactions` table can
 * currently persist; `AiIntent` describes everything the AI layer must be
 * able to *classify*, including non-transaction intents (queries, small
 * talk, edit/delete commands) that never reach entity extraction at all
 * (§4.3.3's flow: non-transaction-logging intents route directly to a
 * handler, bypassing §4.4 Entity Extraction).
 */
export const AI_INTENTS = [
  'EXPENSE',
  'INCOME',
  'SALARY',
  'DEBT_GIVEN',
  'DEBT_RECEIVED',
  'DEBT_REPAYMENT_MADE',
  'DEBT_REPAYMENT_RECEIVED',
  'TRANSFER',
  'INVESTMENT',
  'SAVINGS',
  'REFUND',
  'LOAN',
  'INSTALLMENT',
  'SUBSCRIPTION',
  'CURRENCY_EXCHANGE',
  'CASH_WITHDRAWAL',
  'QUERY_REPORT',
  'QUERY_BUDGET',
  'EDIT_TRANSACTION',
  'DELETE_TRANSACTION',
  'UNDO',
  'SMALL_TALK',
  'HELP',
  'UNKNOWN',
] as const;

export type AiIntent = (typeof AI_INTENTS)[number];

/**
 * The subset of `AiIntent` that is a transaction-logging intent — per
 * §4.3.3's flow diagram, only these proceed to Entity Extraction (§4.4) at
 * all. `amount`/`currency`/`transaction_date` are required "for financial
 * intents" (§4.4.1) — this is that set.
 */
export const FINANCIAL_INTENTS: readonly AiIntent[] = [
  'EXPENSE',
  'INCOME',
  'SALARY',
  'DEBT_GIVEN',
  'DEBT_RECEIVED',
  'DEBT_REPAYMENT_MADE',
  'DEBT_REPAYMENT_RECEIVED',
  'TRANSFER',
  'INVESTMENT',
  'SAVINGS',
  'REFUND',
  'LOAN',
  'INSTALLMENT',
  'SUBSCRIPTION',
  'CURRENCY_EXCHANGE',
  'CASH_WITHDRAWAL',
];

/** §4.4.1: "`counterparty` ... Required for DEBT_* / TRANSFER intents". */
export const COUNTERPARTY_REQUIRED_INTENTS: readonly AiIntent[] = [
  'DEBT_GIVEN',
  'DEBT_RECEIVED',
  'DEBT_REPAYMENT_MADE',
  'DEBT_REPAYMENT_RECEIVED',
  'TRANSFER',
];

/** EXPENSE/INCOME only — §4.4.1: "`category` ... Yes for EXPENSE/INCOME". */
export const CATEGORY_REQUIRED_INTENTS: readonly AiIntent[] = ['EXPENSE', 'INCOME'];

/**
 * §4.2's three supported languages — the same three values already
 * enforced by the `users.preferred_language` CHECK constraint
 * (packages/infrastructure/prisma/migrations), reused here for
 * `detected_language` rather than inventing a second language-code set.
 */
export const DETECTED_LANGUAGES = ['uz', 'ru', 'en'] as const;
export type DetectedLanguage = (typeof DETECTED_LANGUAGES)[number];

/** §4.6.1 — "Every extracted field carries a confidence score in [0.0, 1.0]", keyed by field name. */
export type ExtractionConfidenceScores = Record<string, number>;

/**
 * §4.4.1's "Target Entity Schema" table, field-for-field. Deliberately
 * excludes `original_text` and `source_type` — the table marks both
 * "Yes (system-populated, not AI-generated)", meaning the AI never outputs
 * them; validating them as part of the AI's structured output would be
 * validating fields the model was never asked to produce.
 */
export interface TransactionExtractionCandidate {
  intent: AiIntent;
  /** null for non-financial intents; required (non-null) for `FINANCIAL_INTENTS`. */
  amount: number | null;
  /** ISO 4217 code; same financial-intent conditioning as `amount` (§4.4.1's table only marks `amount` "(for financial intents)" explicitly, but the same reasoning applies — a `SMALL_TALK` message has no currency to report). */
  currency: string | null;
  /** Required (non-null) only for `CATEGORY_REQUIRED_INTENTS` (EXPENSE/INCOME). */
  category: string | null;
  subcategory: string | null;
  merchant: string | null;
  paymentMethod: PaymentMethod | null;
  /** ISO date string (`YYYY-MM-DD`); required for `FINANCIAL_INTENTS`, same reasoning as `amount`/`currency`. */
  transactionDate: string | null;
  /** `HH:MM:SS`, optional. */
  transactionTime: string | null;
  location: string | null;
  /** Required (non-null) only for `COUNTERPARTY_REQUIRED_INTENTS`. */
  counterparty: string | null;
  dueDate: string | null;
  tags: string[];
  /** §4.4.1: "Yes ... always populated even when other fields are sparse". */
  description: string;
  confidenceScores: ExtractionConfidenceScores;
}

/**
 * The full structured-output envelope, per §4.5.3's worked example — an
 * array of candidates (§4.3.2 FR-AI-011's compound-message support), plus
 * the three sibling fields the sample response shows alongside it.
 */
export interface StructuredExtractionOutput {
  transactions: TransactionExtractionCandidate[];
  detectedLanguage: DetectedLanguage;
  clarificationNeeded: boolean;
  clarificationQuestion: string | null;
}

/**
 * A plain JSON-Schema description of `StructuredExtractionOutput`, for
 * `LlmCompletionRequest.responseSchema` (TASK-INFRA-010's port) — enforcing
 * structured/tool-use-constrained output per §4.5.1 point 3. JSON Schema is
 * a vendor-neutral standard; translating it into a specific provider's
 * native tool-use/function-calling format is that provider's own adapter's
 * job (TASK-AI-002), not this one's.
 */
export const STRUCTURED_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['transactions', 'detectedLanguage', 'clarificationNeeded', 'clarificationQuestion'],
  properties: {
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
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
        ],
        properties: {
          intent: { type: 'string', enum: AI_INTENTS },
          amount: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'] },
          category: { type: ['string', 'null'] },
          subcategory: { type: ['string', 'null'] },
          merchant: { type: ['string', 'null'] },
          paymentMethod: { type: ['string', 'null'] },
          transactionDate: { type: ['string', 'null'] },
          transactionTime: { type: ['string', 'null'] },
          location: { type: ['string', 'null'] },
          counterparty: { type: ['string', 'null'] },
          dueDate: { type: ['string', 'null'] },
          tags: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          confidenceScores: { type: 'object' },
        },
      },
    },
    detectedLanguage: { type: 'string', enum: DETECTED_LANGUAGES },
    clarificationNeeded: { type: 'boolean' },
    clarificationQuestion: { type: ['string', 'null'] },
  },
} as const;
