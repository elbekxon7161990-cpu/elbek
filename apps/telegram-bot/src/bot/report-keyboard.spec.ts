import { Buffer } from 'node:buffer';

import type { InlineKeyboardButton } from 'telegraf/types';
import { describe, expect, it } from 'vitest';

import {
  IMMEDIATE_REPORT_TYPES,
  PICKER_REPORT_TYPES,
  RANGE_REPORT_TYPES,
  REPORT_TYPES,
  buildReportBackKeyboard,
  buildReportCategoryPickerKeyboard,
  buildReportMenuKeyboard,
  buildReportMerchantPickerKeyboard,
  buildReportRangePresetKeyboard,
  hashMerchant,
  isReportType,
} from './report-keyboard';

/** Every button this module builds carries `callback_data` — never a `GameButton`/`url` variant — so this narrows the union for test assertions only. */
function callbackDataOf(button: InlineKeyboardButton): string {
  return (button as { callback_data: string }).callback_data;
}

describe('report-keyboard (TASK-REP-TG)', () => {
  it('lists exactly the 11 real GenerateReportUseCase report types, each in exactly one bucket', () => {
    expect(REPORT_TYPES).toHaveLength(11);
    const bucketed = [...IMMEDIATE_REPORT_TYPES, ...RANGE_REPORT_TYPES, ...PICKER_REPORT_TYPES];
    expect(bucketed.sort()).toEqual([...REPORT_TYPES].sort());
    expect(new Set(bucketed).size).toBe(11);
  });

  it('isReportType accepts only the 11 real values, rejects everything else', () => {
    for (const type of REPORT_TYPES) {
      expect(isReportType(type)).toBe(true);
    }
    expect(isReportType('made_up_type')).toBe(false);
    expect(isReportType('')).toBe(false);
  });

  it('the main menu has one button per report type plus a Cancel button, all with report_ callback_data', () => {
    const keyboard = buildReportMenuKeyboard('en');
    const buttons = keyboard.inline_keyboard.flat();
    const dataValues = buttons.map(callbackDataOf);

    for (const type of REPORT_TYPES) {
      expect(dataValues).toContain(`report_type:${type}`);
    }
    expect(dataValues).toContain('report_cancel');
    for (const value of dataValues) {
      expect(value).toMatch(/^report_/);
      expect(Buffer.byteLength(value!, 'utf8')).toBeLessThanOrEqual(64);
    }
  });

  it('the range preset keyboard offers 7/30/90-day buttons plus Back, scoped to the given report type', () => {
    const keyboard = buildReportRangePresetKeyboard('cash_flow', 'en');
    const dataValues = keyboard.inline_keyboard.flat().map(callbackDataOf);

    expect(dataValues).toContain('report_range:cash_flow:7');
    expect(dataValues).toContain('report_range:cash_flow:30');
    expect(dataValues).toContain('report_range:cash_flow:90');
    expect(dataValues).toContain('report_back');
  });

  it('the category picker returns null (never an empty menu) when there is nothing to pick from', () => {
    expect(buildReportCategoryPickerKeyboard([], 'en')).toBeNull();
  });

  it('the category picker builds one deterministic report_cat:<categoryId> button per category, plus Back', () => {
    const keyboard = buildReportCategoryPickerKeyboard(
      [
        { categoryId: 'cat-1', totalAmount: '10.00' },
        { categoryId: 'cat-2', totalAmount: '5.00' },
      ],
      'en',
    );
    const dataValues = keyboard!.inline_keyboard.flat().map(callbackDataOf);

    expect(dataValues).toContain('report_cat:cat-1');
    expect(dataValues).toContain('report_cat:cat-2');
    expect(dataValues).toContain('report_back');
  });

  it('the merchant picker returns null when there is nothing to pick from', () => {
    expect(buildReportMerchantPickerKeyboard([], 'en')).toBeNull();
  });

  it('the merchant picker never puts the raw merchant name in callback_data — only a short deterministic hash', () => {
    const keyboard = buildReportMerchantPickerKeyboard(
      [{ merchant: 'A Very Specific Coffee Shop Name', totalAmount: '12.00', transactionCount: 3 }],
      'en',
    );
    const [[button]] = keyboard!.inline_keyboard;
    const data = callbackDataOf(button!);

    expect(data).toBe(`report_mer:${hashMerchant('A Very Specific Coffee Shop Name')}`);
    expect(data).not.toContain('Coffee Shop');
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
  });

  it('hashMerchant is deterministic and short (rule: short + deterministic callback data)', () => {
    const hash1 = hashMerchant('Some Merchant');
    const hash2 = hashMerchant('Some Merchant');
    const hash3 = hashMerchant('A Different Merchant');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(12);
  });

  it('the back keyboard always offers a report_back button', () => {
    const keyboard = buildReportBackKeyboard('en');
    const dataValues = keyboard.inline_keyboard.flat().map(callbackDataOf);
    expect(dataValues).toContain('report_back');
  });
});
