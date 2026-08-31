import { Module } from '@nestjs/common';

import { GetUserSettingsSummaryUseCase } from '../use-cases/get-user-settings-summary.use-case';
import { SetUserPreferenceUseCase } from '../use-cases/set-user-preference.use-case';
import { UpdateUserProfileUseCase } from '../use-cases/update-user-profile.use-case';

/**
 * `/settings` (Chapter 7 §7.3/§7.4) — does not bind `USER_REPOSITORY`/
 * `CURRENCY_REPOSITORY`/`USER_PREFERENCE_REPOSITORY`; binding domain ports
 * to real implementations is the composition root's job, the same split
 * every other module in this package uses.
 */
@Module({
  providers: [UpdateUserProfileUseCase, SetUserPreferenceUseCase, GetUserSettingsSummaryUseCase],
  exports: [UpdateUserProfileUseCase, SetUserPreferenceUseCase, GetUserSettingsSummaryUseCase],
})
export class UserSettingsModule {}
