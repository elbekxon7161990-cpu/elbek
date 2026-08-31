import { Inject, Injectable } from '@nestjs/common';
import type { User, UserRepository } from '@afa/domain';
import { USER_REPOSITORY } from '@afa/domain';

import type { ProvisionTelegramUserInput } from '../dto/provision-telegram-user.input';

export interface ProvisionTelegramUserResult {
  user: User;
  isNewUser: boolean;
}

function deriveDisplayName(firstName?: string, lastName?: string): string | undefined {
  const parts = [firstName, lastName].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function derivePreferredLanguage(languageCode?: string): string | undefined {
  return languageCode?.split('-')[0]?.toLowerCase() || undefined;
}

/**
 * TASK-AUTH-001 — FR-AUTH-001/002/003, BR-AUTH-001/002. Called on every
 * Telegram update carrying `ctx.from` (apps/telegram-bot's bot.use()
 * middleware), not just /start, per FR-AUTH-001's "first message of any
 * kind." Idempotent for already-active users (US-AUTH-002).
 */
@Injectable()
export class ProvisionTelegramUserUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepository) {}

  async execute(input: ProvisionTelegramUserInput): Promise<ProvisionTelegramUserResult> {
    const existing = await this.userRepository.findByTelegramUserId(input.telegramUserId);

    if (existing) {
      if (existing.status === 'deactivated') {
        // BR-AUTH-002 — blocked-then-unblocked user, history preserved.
        const reactivated = await this.userRepository.reactivate(existing.id);
        return { user: reactivated, isNewUser: false };
      }
      return { user: existing, isNewUser: false };
    }

    const created = await this.userRepository.create({
      telegramUserId: input.telegramUserId,
      telegramUsername: input.telegramUsername,
      displayName: deriveDisplayName(input.firstName, input.lastName),
      preferredLanguage: derivePreferredLanguage(input.languageCode),
    });
    return { user: created, isNewUser: true };
  }
}
