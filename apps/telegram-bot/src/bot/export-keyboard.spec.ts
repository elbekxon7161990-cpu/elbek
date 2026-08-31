import { Buffer } from 'node:buffer';

import type { InlineKeyboardButton } from 'telegraf/types';
import { describe, expect, it } from 'vitest';

import {
  EXPORT_RANGE_PRESETS,
  buildExportMenuKeyboard,
  isExportRangePreset,
} from './export-keyboard';

function callbackDataOf(button: InlineKeyboardButton): string {
  return (button as { callback_data: string }).callback_data;
}

describe('export-keyboard (TASK-FIN-014)', () => {
  it('isExportRangePreset accepts only the real presets, rejects everything else', () => {
    for (const preset of EXPORT_RANGE_PRESETS) {
      expect(isExportRangePreset(preset)).toBe(true);
    }
    expect(isExportRangePreset('made_up_preset')).toBe(false);
    expect(isExportRangePreset('')).toBe(false);
  });

  it('the menu has one button per preset plus a Cancel button, all with export_ callback_data', () => {
    const keyboard = buildExportMenuKeyboard('en');
    const buttons = keyboard.inline_keyboard.flat();
    const dataValues = buttons.map(callbackDataOf);

    for (const preset of EXPORT_RANGE_PRESETS) {
      expect(dataValues).toContain(`export_range:${preset}`);
    }
    expect(dataValues).toContain('export_cancel');
    for (const value of dataValues) {
      expect(value).toMatch(/^export_/);
      expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(64);
    }
  });
});
