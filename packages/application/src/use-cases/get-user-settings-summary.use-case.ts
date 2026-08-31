import { Inject, Injectable } from '@nestjs/common';
import {
  USER_PREFERENCE_REPOSITORY,
  USER_REPOSITORY,
  type User,
  type UserPreferenceRepository,
  type UserRepository,
} from '@afa/domain';

import { SETTINGS_PREFERENCE_KEYS } from './set-user-preference.use-case';

export interface UserSettingsSummary {
  readonly user: User;
  readonly notificationPreferences: {
    readonly debtReminder: boolean;
    readonly budgetAlert: boolean;
  };
  readonly confidenceDisplay: boolean;
}

/** FR-SET-001 — everything the `/settings` top-level menu and its submenus need to render current state in one call. `null` only for the data-integrity edge case of a userId that no longer resolves to a real user. */
@Injectable()
export class GetUserSettingsSummaryUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(USER_PREFERENCE_REPOSITORY)
    private readonly userPreferenceRepository: UserPreferenceRepository,
  ) {}

  async execute(userId: string): Promise<UserSettingsSummary | null> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return null;
    }

    const [debtReminder, budgetAlert, confidenceDisplay] = await Promise.all([
      this.userPreferenceRepository.getBoolean(
        userId,
        SETTINGS_PREFERENCE_KEYS.NOTIF_DEBT_REMINDER,
        true,
      ),
      this.userPreferenceRepository.getBoolean(
        userId,
        SETTINGS_PREFERENCE_KEYS.NOTIF_BUDGET_ALERT,
        true,
      ),
      this.userPreferenceRepository.getBoolean(
        userId,
        SETTINGS_PREFERENCE_KEYS.CONFIDENCE_DISPLAY,
        true,
      ),
    ]);

    return {
      user,
      notificationPreferences: { debtReminder, budgetAlert },
      confidenceDisplay,
    };
  }
}
