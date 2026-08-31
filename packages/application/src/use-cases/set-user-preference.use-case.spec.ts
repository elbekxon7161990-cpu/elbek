import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_PREFERENCE_KEYS, SetUserPreferenceUseCase } from './set-user-preference.use-case';

describe('SetUserPreferenceUseCase (FR-SET-002)', () => {
  it('happy path: writes the given boolean under the given key for the given user', async () => {
    const userPreferenceRepository = { setBoolean: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useCase = new SetUserPreferenceUseCase(userPreferenceRepository as any);

    await useCase.execute('user-1', SETTINGS_PREFERENCE_KEYS.NOTIF_DEBT_REMINDER, false);

    expect(userPreferenceRepository.setBoolean).toHaveBeenCalledWith(
      'user-1',
      'notif_debt_reminder',
      false,
    );
  });

  it('user isolation: the exact userId given is passed straight through, never substituted', async () => {
    const userPreferenceRepository = { setBoolean: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useCase = new SetUserPreferenceUseCase(userPreferenceRepository as any);

    await useCase.execute('user-abc-123', SETTINGS_PREFERENCE_KEYS.CONFIDENCE_DISPLAY, true);

    expect(userPreferenceRepository.setBoolean).toHaveBeenCalledWith(
      'user-abc-123',
      'confidence_display',
      true,
    );
  });

  it('the real preference key constants match the literal strings notification-delivery.consumer.ts already uses', () => {
    expect(SETTINGS_PREFERENCE_KEYS.NOTIF_DEBT_REMINDER).toBe('notif_debt_reminder');
    expect(SETTINGS_PREFERENCE_KEYS.NOTIF_BUDGET_ALERT).toBe('notif_budget_alert');
  });
});
