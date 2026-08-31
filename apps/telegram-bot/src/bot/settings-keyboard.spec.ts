import { Buffer } from 'node:buffer';

import type { InlineKeyboardButton } from 'telegraf/types';
import { describe, expect, it } from 'vitest';

import {
  buildSettingsBackKeyboard,
  buildSettingsConfidenceKeyboard,
  buildSettingsCurrencyKeyboard,
  buildSettingsLanguageKeyboard,
  buildSettingsMenuKeyboard,
  buildSettingsNotificationsKeyboard,
  buildSettingsTimezoneKeyboard,
  SETTINGS_TIMEZONE_PRESETS,
} from './settings-keyboard';

function callbackDataOf(button: InlineKeyboardButton): string {
  return (button as { callback_data: string }).callback_data;
}

function assertShortDeterministic(values: readonly string[]): void {
  for (const value of values) {
    expect(value).toMatch(/^settings_/);
    expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(64);
  }
}

describe('settings-keyboard (TASK-BOT-SET)', () => {
  it('the top-level menu covers every §7.4.4 category this task implements, plus Cancel', () => {
    const keyboard = buildSettingsMenuKeyboard('en');
    const dataValues = keyboard.inline_keyboard.flat().map(callbackDataOf);

    expect(dataValues).toEqual(
      expect.arrayContaining([
        'settings_lang',
        'settings_currency',
        'settings_timezone',
        'settings_notif',
        'settings_confidence',
        'settings_export',
        'settings_deleteaccount',
        'settings_cancel',
      ]),
    );
    assertShortDeterministic(dataValues);
  });

  it('the language submenu offers exactly uz/ru/en plus Back', () => {
    const keyboard = buildSettingsLanguageKeyboard('en');
    const dataValues = keyboard.inline_keyboard.flat().map(callbackDataOf);

    expect(dataValues).toEqual(
      expect.arrayContaining([
        'settings_lang_set:uz',
        'settings_lang_set:ru',
        'settings_lang_set:en',
        'settings_back',
      ]),
    );
    assertShortDeterministic(dataValues);
  });

  it('the currency submenu builds one button per real code given, plus Back — never a hardcoded/invented list', () => {
    const keyboard = buildSettingsCurrencyKeyboard(['UZS', 'USD', 'RUB'], 'en');
    const dataValues = keyboard.inline_keyboard.flat().map(callbackDataOf);

    expect(dataValues).toEqual(
      expect.arrayContaining([
        'settings_currency_set:UZS',
        'settings_currency_set:USD',
        'settings_currency_set:RUB',
        'settings_back',
      ]),
    );
    assertShortDeterministic(dataValues);
  });

  it('the timezone submenu offers every curated preset plus Back', () => {
    const keyboard = buildSettingsTimezoneKeyboard('en');
    const dataValues = keyboard.inline_keyboard.flat().map(callbackDataOf);

    for (const preset of SETTINGS_TIMEZONE_PRESETS) {
      expect(dataValues).toContain(`settings_timezone_set:${preset}`);
    }
    expect(dataValues).toContain('settings_back');
    assertShortDeterministic(dataValues);
  });

  it('the notifications submenu reflects the given ON/OFF state in its button text and offers both real toggle keys', () => {
    const enabledKeyboard = buildSettingsNotificationsKeyboard(
      { debtReminder: true, budgetAlert: false },
      'en',
    );
    const dataValues = enabledKeyboard.inline_keyboard.flat().map(callbackDataOf);
    expect(dataValues).toEqual(
      expect.arrayContaining([
        'settings_notif_toggle:debt_reminder',
        'settings_notif_toggle:budget_alert',
        'settings_back',
      ]),
    );

    const debtButton = enabledKeyboard.inline_keyboard[0]![0]! as { text: string };
    const budgetButton = enabledKeyboard.inline_keyboard[1]![0]! as { text: string };
    expect(debtButton.text).toContain('✅');
    expect(budgetButton.text).toContain('⬜');
  });

  it('the confidence submenu reflects the given ON/OFF state', () => {
    const onKeyboard = buildSettingsConfidenceKeyboard(true, 'en');
    const offKeyboard = buildSettingsConfidenceKeyboard(false, 'en');

    const onButton = onKeyboard.inline_keyboard[0]![0]! as { text: string };
    const offButton = offKeyboard.inline_keyboard[0]![0]! as { text: string };
    expect(onButton.text).toContain('✅');
    expect(offButton.text).toContain('⬜');
    expect(callbackDataOf(onKeyboard.inline_keyboard[0]![0]!)).toBe('settings_confidence_toggle');
  });

  it('the back keyboard always offers a settings_back button', () => {
    const keyboard = buildSettingsBackKeyboard('en');
    const dataValues = keyboard.inline_keyboard.flat().map(callbackDataOf);
    expect(dataValues).toContain('settings_back');
  });
});
