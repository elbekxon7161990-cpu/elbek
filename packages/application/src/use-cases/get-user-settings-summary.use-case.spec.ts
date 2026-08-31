import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GetUserSettingsSummaryUseCase } from './get-user-settings-summary.use-case';

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    telegramUserId: 1n,
    telegramUsername: null,
    displayName: null,
    preferredLanguage: 'en',
    defaultCurrency: 'UZS',
    timezone: 'Asia/Tashkent',
    status: 'active',
    onboardingCompletedAt: null,
    deletionRequestedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('GetUserSettingsSummaryUseCase (FR-SET-001)', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let userPreferenceRepository: { getBoolean: ReturnType<typeof vi.fn> };
  let useCase: GetUserSettingsSummaryUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    userPreferenceRepository = { getBoolean: vi.fn().mockResolvedValue(true) };
    useCase = new GetUserSettingsSummaryUseCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userRepository as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userPreferenceRepository as any,
    );
  });

  it('happy path: assembles the user plus every preference into one summary', async () => {
    const summary = await useCase.execute('user-1');

    expect(summary).not.toBeNull();
    expect(summary!.user.id).toBe('user-1');
    expect(summary!.notificationPreferences).toEqual({ debtReminder: true, budgetAlert: true });
    expect(summary!.confidenceDisplay).toBe(true);
  });

  it('returns null when the user no longer resolves', async () => {
    userRepository.findById.mockResolvedValue(null);
    const summary = await useCase.execute('user-gone');
    expect(summary).toBeNull();
  });

  it('reflects a real per-preference difference (never a blanket default across all three)', async () => {
    userPreferenceRepository.getBoolean.mockImplementation(
      async (_userId: string, key: string) => key !== 'notif_budget_alert',
    );

    const summary = await useCase.execute('user-1');

    expect(summary!.notificationPreferences).toEqual({ debtReminder: true, budgetAlert: false });
  });

  it('user isolation: the exact userId given is passed straight through to every lookup', async () => {
    await useCase.execute('user-abc-123');

    expect(userRepository.findById).toHaveBeenCalledWith('user-abc-123');
    for (const call of userPreferenceRepository.getBoolean.mock.calls) {
      expect(call[0]).toBe('user-abc-123');
    }
  });
});
