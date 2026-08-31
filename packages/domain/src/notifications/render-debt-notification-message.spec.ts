import { describe, expect, it } from 'vitest';

import type { DebtReminderPayload, DebtSettledPayload } from '../events/domain-event';
import {
  renderDebtDueApproachingMessage,
  renderDebtOverdueMessage,
  renderDebtSettledMessage,
} from './render-debt-notification-message';

const REMINDER_PAYLOAD: DebtReminderPayload = {
  debtId: 'debt-1',
  userId: 'user-1',
  counterpartyName: 'Aziz',
  outstandingBalance: '50000.00',
  currency: 'UZS',
  dueDate: '2026-09-01',
};

describe('renderDebtDueApproachingMessage / renderDebtOverdueMessage', () => {
  it('renders distinct, non-empty text for every language', () => {
    for (const language of ['uz', 'ru', 'en'] as const) {
      const approaching = renderDebtDueApproachingMessage(REMINDER_PAYLOAD, language);
      const overdue = renderDebtOverdueMessage(REMINDER_PAYLOAD, language);
      expect(approaching.length).toBeGreaterThan(0);
      expect(overdue.length).toBeGreaterThan(0);
      expect(approaching).toContain('Aziz');
      expect(approaching).toContain('50000.00');
      expect(overdue).toContain('Aziz');
    }
  });

  it('never falls back to English for uz/ru', () => {
    const en = renderDebtDueApproachingMessage(REMINDER_PAYLOAD, 'en');
    expect(renderDebtDueApproachingMessage(REMINDER_PAYLOAD, 'uz')).not.toBe(en);
    expect(renderDebtDueApproachingMessage(REMINDER_PAYLOAD, 'ru')).not.toBe(en);
  });
});

describe('renderDebtSettledMessage', () => {
  it('distinguishes repaid from forgiven, in every language', () => {
    const repaid: DebtSettledPayload = {
      debtId: 'debt-1',
      userId: 'user-1',
      counterpartyName: 'Aziz',
      status: 'repaid',
    };
    const forgiven: DebtSettledPayload = { ...repaid, status: 'forgiven' };

    for (const language of ['uz', 'ru', 'en'] as const) {
      const repaidMsg = renderDebtSettledMessage(repaid, language);
      const forgivenMsg = renderDebtSettledMessage(forgiven, language);
      expect(repaidMsg).not.toBe(forgivenMsg);
      expect(repaidMsg).toContain('Aziz');
    }
  });
});
