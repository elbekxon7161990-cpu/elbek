import type { DetectedLanguage, TransactionExtractionCandidate } from '@afa/domain';
import { describe, expect, it } from 'vitest';

import {
  awaitingConfirmationGuidanceReply,
  batchCancelConfirmationReply,
  batchReviewCompleteReply,
  cancelledReply,
  clarificationAckReply,
  commandNotYetAvailableReply,
  dashboardEmptyReply,
  documentNotYetSupportedReply,
  documentUnsupportedReply,
  draftsListHeader,
  editFieldNotSupportedReply,
  editPromptReply,
  editValueAcceptedReply,
  editValueInvalidReply,
  extractionUnknownReply,
  groupChatRejectionMessage,
  helpMessage,
  interruptionNote,
  malformedCallbackReply,
  noDraftsReply,
  noOpenDebtsReply,
  nothingToCancelReply,
  noTransactionDetectedReply,
  photoAckReply,
  photoInvalidReply,
  renderBatchAllHighConfidenceCommittedMessage,
  renderBatchHighConfidenceCommittedMessage,
  renderBatchItemMessage,
  renderBatchSummaryMessage,
  renderCashFlowReport,
  renderCategoryReport,
  renderConfirmationMessage,
  renderCustomRangeReport,
  renderDailyReport,
  renderDashboard,
  renderDebtSummaryReport,
  renderDebtsList,
  renderDraftsList,
  renderMerchantReport,
  renderMonthlyReport,
  renderQuarterlyReport,
  renderTrendAnalysisReport,
  renderWeeklyReport,
  renderYearlyReport,
  splitTelegramMessage,
  staleCallbackReply,
  storageFailureReply,
  undoneReply,
  unsupportedMessageTypeReply,
  voiceAckReply,
  voiceInvalidReply,
  welcomeNewUserMessage,
  welcomeReturningUserMessage,
} from './reply-messages';

function candidate(
  overrides: Partial<TransactionExtractionCandidate> = {},
): TransactionExtractionCandidate {
  return {
    intent: 'EXPENSE',
    amount: 45000,
    currency: 'UZS',
    category: 'FOOD_DINING',
    subcategory: null,
    merchant: null,
    paymentMethod: null,
    transactionDate: '2026-08-14',
    transactionTime: null,
    location: null,
    counterparty: null,
    dueDate: null,
    tags: [],
    description: 'Lunch',
    confidenceScores: {
      intent: 0.97,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
    ...overrides,
  };
}

const LANGUAGES: readonly DetectedLanguage[] = ['uz', 'ru', 'en'];

describe('renderConfirmationMessage (TASK-BOT-004, FR-CE-010/011/012)', () => {
  it('shows the real amount/currency/category/date — never a generic placeholder', () => {
    const text = renderConfirmationMessage(candidate(), [], 'en');

    expect(text).toContain('45,000 UZS');
    expect(text).toContain('FOOD_DINING');
    expect(text).toContain('2026-08-14');
    expect(text).not.toMatch(/got it/i);
  });

  it('never fabricates or alters the amount — exact value, grouped only', () => {
    const text = renderConfirmationMessage(candidate({ amount: 1234567 }), [], 'en');
    expect(text).toContain('1,234,567 UZS');
  });

  it('reports "Amount not recorded" rather than inventing a value when amount is null (per language)', () => {
    expect(renderConfirmationMessage(candidate({ amount: null }), [], 'en')).toContain(
      'Amount not recorded',
    );
    expect(renderConfirmationMessage(candidate({ amount: null }), [], 'uz')).toContain(
      'Summa qayd etilmagan',
    );
    expect(renderConfirmationMessage(candidate({ amount: null }), [], 'ru')).toContain(
      'Сумма не указана',
    );
  });

  it('appends a flagged-fields note only when there are flagged fields (FR-CE-012)', () => {
    const clean = renderConfirmationMessage(candidate(), [], 'en');
    const flagged = renderConfirmationMessage(candidate(), ['category'], 'en');

    expect(clean).not.toContain('Not fully confident');
    expect(flagged).toContain('Not fully confident about: category');
  });

  it('omits merchant when absent, includes it when present, without inventing one', () => {
    const withoutMerchant = renderConfirmationMessage(candidate({ merchant: null }), [], 'en');
    const withMerchant = renderConfirmationMessage(candidate({ merchant: 'Cafe X' }), [], 'en');

    expect(withoutMerchant).not.toContain('Cafe X');
    expect(withMerchant).toContain('Cafe X');
  });

  it('amount stays the visually leading element in all three languages (§5.21.3)', () => {
    for (const language of LANGUAGES) {
      const text = renderConfirmationMessage(candidate(), [], language);
      const amountIndex = text.indexOf('45,000 UZS');
      const categoryIndex = text.indexOf('FOOD_DINING');
      expect(amountIndex).toBeGreaterThanOrEqual(0);
      expect(amountIndex).toBeLessThan(categoryIndex);
    }
  });
});

describe('TASK-BOT-006 — batch review reply text (FR-CE-030/031/032)', () => {
  it('renderBatchAllHighConfidenceCommittedMessage reports the real total, with no failure note when everything committed', () => {
    const text = renderBatchAllHighConfidenceCommittedMessage(
      { totalItems: 3, committedCount: 3, failedCount: 0 },
      'en',
    );
    expect(text).toContain('3 transactions');
    expect(text).not.toMatch(/couldn't be saved/);
  });

  it('renderBatchAllHighConfidenceCommittedMessage notes a partial failure without hiding it', () => {
    const text = renderBatchAllHighConfidenceCommittedMessage(
      { totalItems: 3, committedCount: 2, failedCount: 1 },
      'en',
    );
    expect(text).toMatch(/1 of them couldn't be saved/);
  });

  it('renderBatchSummaryMessage shows the real high/low confidence split (FR-CE-030)', () => {
    const text = renderBatchSummaryMessage(
      { totalItems: 3, highConfidenceCount: 1, lowConfidenceCount: 2 },
      'en',
    );
    expect(text).toContain('Found 3 transactions');
    expect(text).toContain('1 high-confidence');
    expect(text).toContain('2 need review');
  });

  it('renderBatchItemMessage shows clear position indication and the real candidate details, never a generic placeholder', () => {
    const text = renderBatchItemMessage(candidate({ description: 'Coffee' }), 2, 5, 'en');
    expect(text).toContain('Item 2 of 5');
    expect(text).toContain('45,000 UZS');
    expect(text).toContain('Coffee');
  });

  it('renderBatchHighConfidenceCommittedMessage reports the real committed count (FR-CE-031)', () => {
    const text = renderBatchHighConfidenceCommittedMessage(
      { committedCount: 2, failedCount: 0 },
      'en',
    );
    expect(text).toContain('Logged 2 confident entries');
  });

  it('renderBatchHighConfidenceCommittedMessage handles the idempotent-replay case (nothing left to commit)', () => {
    const text = renderBatchHighConfidenceCommittedMessage(
      { committedCount: 0, failedCount: 0 },
      'en',
    );
    expect(text).toMatch(/already logged/i);
  });
});

describe('renderDraftsList (FR-CE-020)', () => {
  it('reports the no-drafts message when empty', () => {
    expect(renderDraftsList([], 'en')).toBe(noDraftsReply('en'));
  });

  it('lists amount/category/missing-fields, most-recent-first order preserved by the caller', () => {
    const text = renderDraftsList(
      [
        {
          partialData: { amount: 45000, currency: 'UZS', category: 'FOOD_DINING' },
          missingFields: [],
        },
        {
          partialData: { amount: null, currency: null, category: null },
          missingFields: ['amount'],
        },
      ],
      'en',
    );
    expect(text).toContain('45,000 UZS');
    expect(text).toContain('FOOD_DINING');
    expect(text).toContain('amount unknown');
    expect(text).toContain('still needs: amount');
  });
});

describe('renderDebtsList (FR-DBT-006)', () => {
  it('reports the no-open-debts message when empty', () => {
    expect(renderDebtsList([], 'en')).toBe(noOpenDebtsReply('en'));
  });

  it('groups by given/received direction and shows counterparty, balance, and due date', () => {
    const text = renderDebtsList(
      [
        {
          direction: 'given',
          counterpartyName: 'Aziz',
          outstandingBalance: '50000.00',
          currency: 'UZS',
          dueDate: new Date('2026-09-01'),
        },
        {
          direction: 'received',
          counterpartyName: 'Dilnoza',
          outstandingBalance: '20000.00',
          currency: 'UZS',
          dueDate: null,
        },
      ],
      'en',
    );
    expect(text).toContain('Aziz');
    expect(text).toContain('50000.00 UZS');
    expect(text).toContain('2026-09-01');
    expect(text).toContain('Dilnoza');
    expect(text).toContain('20000.00 UZS');
  });

  it('omits a section entirely when there are no debts of that direction', () => {
    const text = renderDebtsList(
      [
        {
          direction: 'given',
          counterpartyName: 'Aziz',
          outstandingBalance: '50000.00',
          currency: 'UZS',
          dueDate: null,
        },
      ],
      'en',
    );
    expect(text).toContain('Aziz');
    expect(text).not.toMatch(/you owe/i);
  });
});

/**
 * TASK-BOT-008 — comprehensive UZ/RU/EN coverage (FR-CE-060, Chapter 19
 * §19.3's checklist item) across every simple (language-only) exported
 * message function, plus a leak check: no known UZ/RU user may accidentally
 * receive English text (this task's own explicit testing requirement C).
 */
const SIMPLE_MESSAGE_FUNCTIONS: readonly [string, (language: DetectedLanguage) => string][] = [
  ['groupChatRejectionMessage', groupChatRejectionMessage],
  ['unsupportedMessageTypeReply', unsupportedMessageTypeReply],
  ['documentNotYetSupportedReply', documentNotYetSupportedReply],
  ['documentUnsupportedReply', documentUnsupportedReply],
  ['noTransactionDetectedReply', noTransactionDetectedReply],
  ['extractionUnknownReply', extractionUnknownReply],
  ['awaitingConfirmationGuidanceReply', awaitingConfirmationGuidanceReply],
  ['editFieldNotSupportedReply', editFieldNotSupportedReply],
  ['staleCallbackReply', staleCallbackReply],
  ['malformedCallbackReply', malformedCallbackReply],
  ['cancelledReply', cancelledReply],
  ['nothingToCancelReply', nothingToCancelReply],
  ['undoneReply', undoneReply],
  ['noDraftsReply', noDraftsReply],
  ['interruptionNote', interruptionNote],
  ['helpMessage', helpMessage],
  ['commandNotYetAvailableReply', commandNotYetAvailableReply],
  ['batchReviewCompleteReply', batchReviewCompleteReply],
  ['batchCancelConfirmationReply', batchCancelConfirmationReply],
  ['clarificationAckReply', clarificationAckReply],
  ['editValueInvalidReply', editValueInvalidReply],
  ['editValueAcceptedReply', editValueAcceptedReply],
  ['voiceAckReply', voiceAckReply],
  ['photoAckReply', photoAckReply],
  ['voiceInvalidReply', voiceInvalidReply],
  ['photoInvalidReply', photoInvalidReply],
  ['storageFailureReply', storageFailureReply],
  ['welcomeNewUserMessage', welcomeNewUserMessage],
  ['welcomeReturningUserMessage', welcomeReturningUserMessage],
  ['editPromptReply', editPromptReply],
  ['draftsListHeader', draftsListHeader],
  ['noOpenDebtsReply', noOpenDebtsReply],
];

describe('TASK-BOT-008 — every simple message function renders in all three languages', () => {
  it.each(SIMPLE_MESSAGE_FUNCTIONS)(
    '%s returns non-empty, distinct text for uz/ru/en',
    (_name, fn) => {
      const uz = fn('uz');
      const ru = fn('ru');
      const en = fn('en');

      expect(uz.length).toBeGreaterThan(0);
      expect(ru.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);

      // Requirement C — a uz/ru call must never silently return the English
      // variant (the exact failure mode a missing/forgotten language branch
      // would produce).
      expect(uz).not.toBe(en);
      expect(ru).not.toBe(en);
      expect(uz).not.toBe(ru);
    },
  );
});

describe('TASK-BOT-008 — parameterized message functions render in all three languages', () => {
  it('renderConfirmationMessage', () => {
    const c = candidate();
    const uz = renderConfirmationMessage(c, ['category'], 'uz');
    const ru = renderConfirmationMessage(c, ['category'], 'ru');
    const en = renderConfirmationMessage(c, ['category'], 'en');
    expect(uz).not.toBe(en);
    expect(ru).not.toBe(en);
  });

  it('renderBatchAllHighConfidenceCommittedMessage', () => {
    const outcome = { totalItems: 2, committedCount: 1, failedCount: 1 };
    const uz = renderBatchAllHighConfidenceCommittedMessage(outcome, 'uz');
    const ru = renderBatchAllHighConfidenceCommittedMessage(outcome, 'ru');
    const en = renderBatchAllHighConfidenceCommittedMessage(outcome, 'en');
    expect(uz).not.toBe(en);
    expect(ru).not.toBe(en);
  });

  it('renderBatchSummaryMessage', () => {
    const outcome = { totalItems: 3, highConfidenceCount: 1, lowConfidenceCount: 2 };
    const uz = renderBatchSummaryMessage(outcome, 'uz');
    const ru = renderBatchSummaryMessage(outcome, 'ru');
    const en = renderBatchSummaryMessage(outcome, 'en');
    expect(uz).not.toBe(en);
    expect(ru).not.toBe(en);
  });

  it('renderBatchItemMessage', () => {
    const c = candidate();
    const uz = renderBatchItemMessage(c, 1, 2, 'uz');
    const ru = renderBatchItemMessage(c, 1, 2, 'ru');
    const en = renderBatchItemMessage(c, 1, 2, 'en');
    expect(uz).not.toBe(en);
    expect(ru).not.toBe(en);
    expect(uz).toContain('1');
    expect(ru).toContain('1');
  });

  it('renderBatchHighConfidenceCommittedMessage', () => {
    const outcome = { committedCount: 1, failedCount: 1 };
    const uz = renderBatchHighConfidenceCommittedMessage(outcome, 'uz');
    const ru = renderBatchHighConfidenceCommittedMessage(outcome, 'ru');
    const en = renderBatchHighConfidenceCommittedMessage(outcome, 'en');
    expect(uz).not.toBe(en);
    expect(ru).not.toBe(en);
  });

  it('renderBatchHighConfidenceCommittedMessage idempotent-replay ("already logged") case', () => {
    const outcome = { committedCount: 0, failedCount: 0 };
    const uz = renderBatchHighConfidenceCommittedMessage(outcome, 'uz');
    const ru = renderBatchHighConfidenceCommittedMessage(outcome, 'ru');
    const en = renderBatchHighConfidenceCommittedMessage(outcome, 'en');
    expect(uz).not.toBe(en);
    expect(ru).not.toBe(en);
  });

  it('renderDraftsList', () => {
    const drafts = [
      {
        partialData: { amount: 45000, currency: 'UZS', category: 'FOOD_DINING' },
        missingFields: [],
      },
    ];
    const uz = renderDraftsList(drafts, 'uz');
    const ru = renderDraftsList(drafts, 'ru');
    const en = renderDraftsList(drafts, 'en');
    expect(uz).not.toBe(en);
    expect(ru).not.toBe(en);
  });

  it('renderDraftsList empty case', () => {
    const uz = renderDraftsList([], 'uz');
    const ru = renderDraftsList([], 'ru');
    const en = renderDraftsList([], 'en');
    expect(uz).not.toBe(en);
    expect(ru).not.toBe(en);
  });
});

describe('renderDashboard / dashboardEmptyReply (TASK-REP-004, FR-DSH-001)', () => {
  function fullSummary() {
    return {
      periodKey: '2026-08',
      totalExpense: '300000.00',
      totalIncome: '1000000.00',
      netCashFlow: '700000.00',
      topCategories: [
        { categoryId: 'food', totalAmount: '150000.00' },
        { categoryId: 'transport', totalAmount: '80000.00' },
      ],
      overallBudgetUtilization: {
        usedAmount: '200000.00',
        utilizationPercent: 20,
        budget: { limitAmount: '1000000.00', currency: 'UZS' },
      },
      openDebtsGiven: {
        count: 1,
        totalOutstandingByCurrency: [{ currency: 'UZS', totalOutstanding: '50000.00' }],
      },
      openDebtsReceived: {
        count: 1,
        totalOutstandingByCurrency: [{ currency: 'USD', totalOutstanding: '25.00' }],
      },
      pendingDraftCount: 2,
    };
  }

  it('includes every FR-DSH-001 figure in the rendered message', () => {
    const text = renderDashboard(fullSummary(), 'en');
    expect(text).toContain('300000.00');
    expect(text).toContain('1000000.00');
    expect(text).toContain('700000.00');
    expect(text).toContain('food');
    expect(text).toContain('transport');
    expect(text).toContain('20.0%');
    expect(text).toContain('50000.00 UZS');
    expect(text).toContain('25.00 USD');
    expect(text).toContain('2');
  });

  it('omits the budget section entirely when no overall-scope budget is set, never a misleading 0%', () => {
    const text = renderDashboard({ ...fullSummary(), overallBudgetUtilization: null }, 'en');
    expect(text).not.toContain('%');
  });

  it('omits the debts section entirely when there are no open debts in either direction', () => {
    const text = renderDashboard(
      {
        ...fullSummary(),
        openDebtsGiven: { count: 0, totalOutstandingByCurrency: [] },
        openDebtsReceived: { count: 0, totalOutstandingByCurrency: [] },
      },
      'en',
    );
    expect(text.toLowerCase()).not.toContain('debt');
  });

  it('omits the pending-drafts line when there are none', () => {
    const text = renderDashboard({ ...fullSummary(), pendingDraftCount: 0 }, 'en');
    expect(text.toLowerCase()).not.toContain('draft');
  });

  it('omits the top-categories section entirely when there is no spend at all', () => {
    const text = renderDashboard({ ...fullSummary(), topCategories: [] }, 'en');
    expect(text.toLowerCase()).not.toContain('categor');
  });

  it('renders each debt-direction currency total separately, never summed across currencies', () => {
    const text = renderDashboard(
      {
        ...fullSummary(),
        openDebtsGiven: {
          count: 2,
          totalOutstandingByCurrency: [
            { currency: 'UZS', totalOutstanding: '1500.00' },
            { currency: 'USD', totalOutstanding: '50.00' },
          ],
        },
      },
      'en',
    );
    expect(text).toContain('1500.00 UZS');
    expect(text).toContain('50.00 USD');
  });

  it('dashboardEmptyReply differs across all three languages and never contains a numeric figure', () => {
    const uz = dashboardEmptyReply('uz');
    const ru = dashboardEmptyReply('ru');
    const en = dashboardEmptyReply('en');
    expect(uz).not.toBe(en);
    expect(ru).not.toBe(en);
    expect(en).not.toMatch(/\d/);
  });
});

const reportDateRange = { start: new Date('2026-08-01'), end: new Date('2026-08-30') };

describe('/report renderers (TASK-REP-TG)', () => {
  it('renderDailyReport returns null when there is nothing to show', () => {
    expect(
      renderDailyReport(
        {
          reportType: 'daily',
          periodKey: '2026-08-30',
          totalExpense: '0.00',
          totalIncome: '0.00',
          categoryBreakdown: [],
          comparisonToDailyAverage: null,
        },
        'en',
      ),
    ).toBeNull();
  });

  it('renderDailyReport renders totals, category breakdown, and the average comparison when present', () => {
    const text = renderDailyReport(
      {
        reportType: 'daily',
        periodKey: '2026-08-30',
        totalExpense: '15.50',
        totalIncome: '0.00',
        categoryBreakdown: [{ categoryId: 'food', totalAmount: '15.50' }],
        comparisonToDailyAverage: { averageDailyExpense: '12.00' },
      },
      'en',
    );

    expect(text).toContain('2026-08-30');
    expect(text).toContain('15.50');
    expect(text).toContain('food');
    expect(text).toContain('12.00');
  });

  it('renderWeeklyReport returns null when empty, renders day-by-day trend and prior-week comparison otherwise', () => {
    expect(
      renderWeeklyReport(
        {
          reportType: 'weekly',
          periodKey: '2026-W35',
          totalExpense: '0.00',
          totalIncome: '0.00',
          categoryBreakdown: [],
          dayByDayTrend: [],
          priorWeekComparison: null,
        },
        'en',
      ),
    ).toBeNull();

    const text = renderWeeklyReport(
      {
        reportType: 'weekly',
        periodKey: '2026-W35',
        totalExpense: '40.00',
        totalIncome: '0.00',
        categoryBreakdown: [],
        dayByDayTrend: [
          { bucketStart: new Date('2026-08-24'), totalExpense: '40.00', totalIncome: '0.00' },
        ],
        priorWeekComparison: { totalExpense: '30.00', totalIncome: '0.00' },
      },
      'en',
    );
    expect(text).toContain('2026-08-24');
    expect(text).toContain('30.00');
  });

  it('renderMonthlyReport returns null when empty, renders budget performance bars otherwise', () => {
    expect(
      renderMonthlyReport(
        {
          reportType: 'monthly',
          periodKey: '2026-08',
          totalExpense: '0.00',
          totalIncome: '0.00',
          totalSaved: '0.00',
          categoryBreakdown: [],
          topMerchants: [],
          budgetPerformance: [],
          priorMonthComparison: null,
        },
        'en',
      ),
    ).toBeNull();

    const text = renderMonthlyReport(
      {
        reportType: 'monthly',
        periodKey: '2026-08',
        totalExpense: '100.00',
        totalIncome: '500.00',
        totalSaved: '400.00',
        categoryBreakdown: [{ categoryId: 'food', totalAmount: '100.00' }],
        topMerchants: [{ merchant: 'Store', totalAmount: '50.00', transactionCount: 2 }],
        budgetPerformance: [
          {
            budgetId: 'b1',
            scopeType: 'overall',
            categoryId: null,
            limitAmount: '200.00',
            usedAmount: '100.00',
            utilizationPercent: 50,
          },
        ],
        priorMonthComparison: null,
      },
      'en',
    );
    expect(text).toContain('400.00');
    expect(text).toContain('50.0%');
    expect(text).toContain('Store');
  });

  it('renderQuarterlyReport returns null when empty, renders current/prior category shift otherwise', () => {
    expect(
      renderQuarterlyReport(
        {
          reportType: 'quarterly',
          periodKey: '2026-Q3',
          monthlyTrend: [],
          categoryShift: { current: [], prior: [] },
        },
        'en',
      ),
    ).toBeNull();

    const text = renderQuarterlyReport(
      {
        reportType: 'quarterly',
        periodKey: '2026-Q3',
        monthlyTrend: [
          { bucketStart: new Date('2026-07-01'), totalExpense: '10.00', totalIncome: '0.00' },
        ],
        categoryShift: {
          current: [{ categoryId: 'food', totalAmount: '10.00' }],
          prior: [{ categoryId: 'food', totalAmount: '8.00' }],
        },
      },
      'en',
    );
    expect(text).toContain('Current quarter');
    expect(text).toContain('Prior quarter');
  });

  it('renderYearlyReport returns null when empty, renders year-over-year comparison otherwise', () => {
    expect(
      renderYearlyReport(
        {
          reportType: 'yearly',
          periodKey: '2026',
          totalExpense: '0.00',
          totalIncome: '0.00',
          monthByMonthTrend: [],
          categoryBreakdown: [],
          yearOverYearComparison: null,
        },
        'en',
      ),
    ).toBeNull();

    const text = renderYearlyReport(
      {
        reportType: 'yearly',
        periodKey: '2026',
        totalExpense: '1200.00',
        totalIncome: '6000.00',
        monthByMonthTrend: [],
        categoryBreakdown: [],
        yearOverYearComparison: { totalExpense: '1000.00', totalIncome: '5000.00' },
      },
      'en',
    );
    expect(text).toContain('Year over year');
    expect(text).toContain('1000.00');
  });

  it('renderCashFlowReport returns null when empty, renders net/full cash flow otherwise', () => {
    expect(
      renderCashFlowReport(
        {
          reportType: 'cash_flow',
          range: reportDateRange,
          totalExpense: '0.00',
          totalIncome: '0.00',
          periodicTrend: [],
          netCashFlow: '0.00',
          fullCashFlow: null,
        },
        'en',
      ),
    ).toBeNull();

    const text = renderCashFlowReport(
      {
        reportType: 'cash_flow',
        range: reportDateRange,
        totalExpense: '100.00',
        totalIncome: '300.00',
        periodicTrend: [],
        netCashFlow: '200.00',
        fullCashFlow: '150.00',
      },
      'en',
    );
    expect(text).toContain('200.00');
    expect(text).toContain('150.00');
    expect(text).toContain('2026-08-01');
  });

  it('renderDebtSummaryReport returns null when there are no debts at all, renders given/received/settled otherwise', () => {
    expect(
      renderDebtSummaryReport(
        { reportType: 'debt_summary', openDebtsGiven: [], openDebtsReceived: [], settledDebts: [] },
        'en',
      ),
    ).toBeNull();

    const text = renderDebtSummaryReport(
      {
        reportType: 'debt_summary',
        openDebtsGiven: [
          {
            debtId: 'd1',
            direction: 'given',
            counterpartyName: 'Ali',
            originalAmount: '100.00',
            outstandingBalance: '50.00',
            currency: 'UZS',
            dueDate: new Date('2026-09-01'),
            overdueDays: null,
          },
        ],
        openDebtsReceived: [],
        settledDebts: [
          {
            debtId: 'd2',
            direction: 'received',
            counterpartyName: 'Vali',
            originalAmount: '30.00',
            currency: 'UZS',
            status: 'repaid',
            settledAt: new Date('2026-08-01'),
          },
        ],
      },
      'en',
    );
    expect(text).toContain('Ali');
    expect(text).toContain('50.00 UZS');
    expect(text).toContain('Vali');
    expect(text).toContain('repaid');
  });

  it('renderCategoryReport returns null when empty, renders largest transactions otherwise', () => {
    expect(
      renderCategoryReport(
        {
          reportType: 'category',
          categoryId: 'cat-1',
          range: reportDateRange,
          trend: [],
          merchantBreakdown: [],
          largestTransactions: [],
        },
        'en',
      ),
    ).toBeNull();

    const text = renderCategoryReport(
      {
        reportType: 'category',
        categoryId: 'cat-1',
        range: reportDateRange,
        trend: [],
        merchantBreakdown: [],
        largestTransactions: [
          {
            id: 't1',
            amount: '99.00',
            transactionType: 'EXPENSE',
            categoryId: 'cat-1',
            merchant: 'Store',
            transactionDate: new Date('2026-08-05'),
            description: 'Big purchase',
          },
        ],
      },
      'en',
    );
    expect(text).toContain('cat-1');
    expect(text).toContain('Big purchase');
    expect(text).toContain('99.00');
  });

  it('renderMerchantReport returns null when the merchant has zero transactions, renders totals otherwise', () => {
    expect(
      renderMerchantReport(
        {
          reportType: 'merchant',
          merchant: 'Store',
          range: reportDateRange,
          totalAmount: '0.00',
          transactionCount: 0,
          trend: [],
        },
        'en',
      ),
    ).toBeNull();

    const text = renderMerchantReport(
      {
        reportType: 'merchant',
        merchant: 'Store',
        range: reportDateRange,
        totalAmount: '75.00',
        transactionCount: 3,
        trend: [],
      },
      'en',
    );
    expect(text).toContain('Store');
    expect(text).toContain('75.00');
    expect(text).toContain('3');
  });

  it('renderCustomRangeReport returns null when empty, renders category and merchant breakdowns otherwise', () => {
    expect(
      renderCustomRangeReport(
        {
          reportType: 'custom_range',
          range: reportDateRange,
          totalExpense: '0.00',
          totalIncome: '0.00',
          categoryBreakdown: [],
          merchantBreakdown: [],
        },
        'en',
      ),
    ).toBeNull();

    const text = renderCustomRangeReport(
      {
        reportType: 'custom_range',
        range: reportDateRange,
        totalExpense: '20.00',
        totalIncome: '0.00',
        categoryBreakdown: [{ categoryId: 'food', totalAmount: '20.00' }],
        merchantBreakdown: [{ merchant: 'Store', totalAmount: '20.00', transactionCount: 1 }],
      },
      'en',
    );
    expect(text).toContain('food');
    expect(text).toContain('Store');
  });

  it('renderTrendAnalysisReport returns null when empty, renders category trajectory otherwise', () => {
    expect(
      renderTrendAnalysisReport(
        {
          reportType: 'trend_analysis',
          range: reportDateRange,
          monthlyTrend: [],
          categoryTrajectory: [],
        },
        'en',
      ),
    ).toBeNull();

    const text = renderTrendAnalysisReport(
      {
        reportType: 'trend_analysis',
        range: reportDateRange,
        monthlyTrend: [],
        categoryTrajectory: [
          {
            categoryId: 'food',
            direction: 'increasing',
            firstHalfTotal: '10.00',
            secondHalfTotal: '20.00',
          },
        ],
      },
      'en',
    );
    expect(text).toContain('increasing');
    expect(text).toContain('10.00');
    expect(text).toContain('20.00');
  });
});

describe('splitTelegramMessage (Telegram 4096-char limit)', () => {
  it('returns the original text unsplit when it is within the limit', () => {
    expect(splitTelegramMessage('short text')).toEqual(['short text']);
  });

  it('splits on blank-line section boundaries, keeping each chunk within the limit', () => {
    const section = 'a'.repeat(2000);
    const text = [section, section, section].join('\n\n');

    const chunks = splitTelegramMessage(text, 4096);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('hard-slices a single section that alone exceeds the limit', () => {
    const hugeSection = 'b'.repeat(9000);

    const chunks = splitTelegramMessage(hugeSection, 4096);

    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
    expect(chunks.join('')).toBe(hugeSection);
  });
});
