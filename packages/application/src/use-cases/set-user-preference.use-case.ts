import { Inject, Injectable } from '@nestjs/common';
import { USER_PREFERENCE_REPOSITORY, type UserPreferenceRepository } from '@afa/domain';

/**
 * The exact same literal key strings `notification-delivery.consumer.ts`'s
 * own private `DEBT_REMINDER_PREFERENCE_KEY`/`BUDGET_ALERT_PREFERENCE_KEY`
 * constants already use — not re-exported from there (that file is
 * TASK-BOT-009's own, not touched by this task), duplicated here
 * deliberately so a toggle this use case writes is picked up by that
 * existing, unmodified notification-delivery pipeline. Verified end-to-end
 * in `prisma-user-preference.repository.integration.spec.ts`.
 *
 * `CONFIDENCE_DISPLAY` (§7.4.4's "confidence display preference") is new —
 * no existing consumer reads it yet; this task only implements the
 * store/toggle side (a disclosed, deliberate scope decision — see this
 * task's final report).
 */
export const SETTINGS_PREFERENCE_KEYS = {
  NOTIF_DEBT_REMINDER: 'notif_debt_reminder',
  NOTIF_BUDGET_ALERT: 'notif_budget_alert',
  CONFIDENCE_DISPLAY: 'confidence_display',
} as const;

export type SettingsPreferenceKey =
  (typeof SETTINGS_PREFERENCE_KEYS)[keyof typeof SETTINGS_PREFERENCE_KEYS];

/** FR-SET-002 — "each notification type must be independently toggleable without affecting others"; also used for the confidence-display preference (same boolean-toggle shape). */
@Injectable()
export class SetUserPreferenceUseCase {
  constructor(
    @Inject(USER_PREFERENCE_REPOSITORY)
    private readonly userPreferenceRepository: UserPreferenceRepository,
  ) {}

  async execute(userId: string, key: SettingsPreferenceKey, value: boolean): Promise<void> {
    await this.userPreferenceRepository.setBoolean(userId, key, value);
  }
}
