import { Injectable } from '@nestjs/common';
import type { NotificationPreferenceRepository } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

interface PreferenceValueShape {
  enabled?: boolean;
}

/**
 * TASK-BOT-009 (FR-NOT-001) — implements @afa/domain's
 * `NotificationPreferenceRepository` port against `user_settings` (§13.9).
 * No row for a given `(userId, settingKey)` means "never explicitly set" —
 * defaults to enabled (§7.4.4/§7.9.4's documented default), matching every
 * real call today since no `/settings` UI exists yet to write an override.
 * A malformed stored value (missing/non-boolean `enabled`) also fails open
 * toward enabled, never silently suppressing a notification because of a
 * corrupted preference row.
 */
@Injectable()
export class PrismaNotificationPreferenceRepository implements NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(userId: string, preferenceKey: string): Promise<boolean> {
    const row = await this.prisma.userSetting.findUnique({
      where: { userId_settingKey: { userId, settingKey: preferenceKey } },
    });
    if (!row) {
      return true;
    }
    const value = row.settingValue as unknown as PreferenceValueShape;
    return value.enabled !== false;
  }
}
