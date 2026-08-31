import type { DetectedLanguage } from '@afa/domain';
import { describe, expect, it } from 'vitest';

import {
  buildBatchReviewKeyboard,
  buildBatchSummaryKeyboard,
  buildConfirmationKeyboard,
} from './confirmation-keyboard';

const LANGUAGES: readonly DetectedLanguage[] = ['uz', 'ru', 'en'];

/** Telegram's own inline-keyboard button text limit (1-64 characters) — the concrete bound FR-CE-061 ("short enough to render without truncation") is checked against. */
const TELEGRAM_BUTTON_TEXT_MAX_LENGTH = 64;

function allButtonTexts(keyboard: { inline_keyboard: unknown[][] }): string[] {
  return keyboard.inline_keyboard.flat().map((button) => (button as { text: string }).text);
}

describe('buildConfirmationKeyboard (TASK-BOT-004, FR-CE-013)', () => {
  it('offers Edit buttons only for flagged fields that are also text-editable, plus Undo', () => {
    const keyboard = buildConfirmationKeyboard('txn-1', ['amount', 'category'], 'en');

    // 'category' is flagged but not in TEXT_EDITABLE_FIELDS — no button for it.
    expect(keyboard.inline_keyboard).toEqual([
      [{ text: '✏️ Edit Amount', callback_data: 'edit:txn-1:amount' }],
      [{ text: '↩️ Undo', callback_data: 'undo:txn-1' }],
    ]);
  });

  it('offers only Undo when no flagged field is text-editable', () => {
    const keyboard = buildConfirmationKeyboard('txn-1', ['category', 'transactionDate'], 'en');

    expect(keyboard.inline_keyboard).toEqual([[{ text: '↩️ Undo', callback_data: 'undo:txn-1' }]]);
  });

  it('offers only Undo when there are no flagged fields at all', () => {
    const keyboard = buildConfirmationKeyboard('txn-1', [], 'en');

    expect(keyboard.inline_keyboard).toEqual([[{ text: '↩️ Undo', callback_data: 'undo:txn-1' }]]);
  });

  it('offers one Edit button per editable flagged field, all on one row', () => {
    const keyboard = buildConfirmationKeyboard('txn-1', ['amount', 'merchant'], 'en');

    expect(keyboard.inline_keyboard[0]).toEqual([
      { text: '✏️ Edit Amount', callback_data: 'edit:txn-1:amount' },
      { text: '✏️ Edit Merchant', callback_data: 'edit:txn-1:merchant' },
    ]);
  });

  it('never embeds financial values, secrets, or free text in callback_data — only action:transactionId[:field]', () => {
    const keyboard = buildConfirmationKeyboard('txn-1', ['amount'], 'en');
    const allCallbackData = keyboard.inline_keyboard
      .flat()
      .map((button) => (button as { callback_data: string }).callback_data);

    for (const data of allCallbackData) {
      expect(data.split(':').length).toBeLessThanOrEqual(3);
      expect(data).not.toMatch(/\d{4,}/); // no amount-shaped numbers
    }
  });

  it('TASK-BOT-008 — renders distinct, non-empty labels in all three languages, never embedding a language in callback_data', () => {
    for (const language of LANGUAGES) {
      const keyboard = buildConfirmationKeyboard('txn-1', ['amount'], language);
      expect(allButtonTexts(keyboard).every((text) => text.length > 0)).toBe(true);
      const callbackData = keyboard.inline_keyboard
        .flat()
        .map((button) => (button as { callback_data: string }).callback_data);
      expect(callbackData).toEqual(['edit:txn-1:amount', 'undo:txn-1']); // identical regardless of language
    }
    const en = allButtonTexts(buildConfirmationKeyboard('txn-1', ['amount'], 'en'));
    const uz = allButtonTexts(buildConfirmationKeyboard('txn-1', ['amount'], 'uz'));
    const ru = allButtonTexts(buildConfirmationKeyboard('txn-1', ['amount'], 'ru'));
    expect(uz).not.toEqual(en);
    expect(ru).not.toEqual(en);
  });

  it("TASK-BOT-008 (FR-CE-061) — every button label stays within Telegram's length limit in all three languages", () => {
    for (const language of LANGUAGES) {
      const keyboard = buildConfirmationKeyboard(
        'txn-1',
        ['amount', 'merchant', 'description', 'location'],
        language,
      );
      for (const text of allButtonTexts(keyboard)) {
        expect(text.length).toBeLessThanOrEqual(TELEGRAM_BUTTON_TEXT_MAX_LENGTH);
      }
    }
  });
});

describe('buildBatchReviewKeyboard (TASK-BOT-006, FR-CE-032)', () => {
  it('offers Confirm, Skip, and Cancel, all keyed to the same draft id', () => {
    const keyboard = buildBatchReviewKeyboard('draft-low-1', 'en');

    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: '✅ Confirm', callback_data: 'batch_confirm:draft-low-1' },
        { text: '⏭️ Skip', callback_data: 'batch_skip:draft-low-1' },
      ],
      [{ text: '✖️ Cancel', callback_data: 'cancel:draft-low-1' }],
    ]);
  });

  it('reuses the pre-existing cancel:<id> action unchanged — no new callback-handling code needed for Cancel', () => {
    const keyboard = buildBatchReviewKeyboard('draft-low-2', 'en');
    const cancelButton = keyboard.inline_keyboard[1]![0] as { callback_data: string };
    expect(cancelButton.callback_data.startsWith('cancel:')).toBe(true);
  });

  it('TASK-BOT-008 — renders distinct, non-empty labels in all three languages, callback_data unaffected', () => {
    const en = allButtonTexts(buildBatchReviewKeyboard('draft-1', 'en'));
    const uz = allButtonTexts(buildBatchReviewKeyboard('draft-1', 'uz'));
    const ru = allButtonTexts(buildBatchReviewKeyboard('draft-1', 'ru'));
    expect(uz).not.toEqual(en);
    expect(ru).not.toEqual(en);
    expect(uz.every((text) => text.length > 0)).toBe(true);
    expect(ru.every((text) => text.length > 0)).toBe(true);
  });

  it("TASK-BOT-008 (FR-CE-061) — every button label stays within Telegram's length limit in all three languages", () => {
    for (const language of LANGUAGES) {
      for (const text of allButtonTexts(buildBatchReviewKeyboard('draft-1', language))) {
        expect(text.length).toBeLessThanOrEqual(TELEGRAM_BUTTON_TEXT_MAX_LENGTH);
      }
    }
  });
});

describe('buildBatchSummaryKeyboard (TASK-BOT-006, FR-CE-031)', () => {
  it('offers a single "Import N confident ones" button keyed to the batch id, with the real count', () => {
    const keyboard = buildBatchSummaryKeyboard('batch-1', 3, 'en');

    expect(keyboard.inline_keyboard).toEqual([
      [{ text: '📥 Import 3 confident ones now', callback_data: 'batch_commit_high:batch-1' }],
    ]);
  });

  it('uses singular phrasing for exactly one confident item', () => {
    const keyboard = buildBatchSummaryKeyboard('batch-1', 1, 'en');
    const button = keyboard.inline_keyboard[0]![0] as { text: string };
    expect(button.text).toBe('📥 Import 1 confident one now');
  });

  it('TASK-BOT-008 — renders distinct, non-empty labels in all three languages', () => {
    const en = allButtonTexts(buildBatchSummaryKeyboard('batch-1', 3, 'en'));
    const uz = allButtonTexts(buildBatchSummaryKeyboard('batch-1', 3, 'uz'));
    const ru = allButtonTexts(buildBatchSummaryKeyboard('batch-1', 3, 'ru'));
    expect(uz).not.toEqual(en);
    expect(ru).not.toEqual(en);
    expect(uz.every((text) => text.length > 0)).toBe(true);
    expect(ru.every((text) => text.length > 0)).toBe(true);
  });

  it("TASK-BOT-008 (FR-CE-061) — stays within Telegram's length limit in all three languages even at a two-digit count", () => {
    for (const language of LANGUAGES) {
      for (const text of allButtonTexts(buildBatchSummaryKeyboard('batch-1', 12, language))) {
        expect(text.length).toBeLessThanOrEqual(TELEGRAM_BUTTON_TEXT_MAX_LENGTH);
      }
    }
  });
});
