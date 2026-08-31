import { Injectable } from '@nestjs/common';
import type { UserPreferenceRepository } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

interface PreferenceValueShape {
  enabled?: boolean;
}

/**
 * Implements @afa/domain's `UserPreferenceRepository` against `user_settings`
 * (§13.9) — the SAME table and `{ enabled: boolean }` JSON shape
 * `PrismaNotificationPreferenceRepository.isEnabled` already reads (see that
 * port's own doc comment), so a toggle written here is correctly visible to
 * the existing notification-delivery pipeline with zero changes to it.
 */
@Injectable()
export class PrismaUserPreferenceRepository implements UserPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getBoolean(userId: string, key: string, defaultValue: boolean): Promise<boolean> {
    const row = await this.prisma.userSetting.findUnique({
      where: { userId_settingKey: { userId, settingKey: key } },
    });
    if (!row) {
      return defaultValue;
    }
    const value = row.settingValue as unknown as PreferenceValueShape;
    return typeof value.enabled === 'boolean' ? value.enabled : defaultValue;
  }

  async setBoolean(userId: string, key: string, value: boolean): Promise<void> {
    await this.prisma.userSetting.upsert({
      where: { userId_settingKey: { userId, settingKey: key } },
      create: { userId, settingKey: key, settingValue: { enabled: value } },
      update: { settingValue: { enabled: value } },
    });
  }
}
