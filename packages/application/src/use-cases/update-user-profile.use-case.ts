import { Inject, Injectable } from '@nestjs/common';
import {
  CURRENCY_REPOSITORY,
  USER_REPOSITORY,
  isValidIanaTimezone,
  toDetectedLanguage,
  type CurrencyRepository,
  type User,
  type UserRepository,
} from '@afa/domain';

export type UpdateUserProfileField = 'language' | 'currency' | 'timezone';

export type UpdateUserProfileOutcome =
  { readonly kind: 'updated'; readonly user: User } | { readonly kind: 'invalid_value' };

/**
 * FR-PROF-002 (Chapter 7 §7.3.5) — "allow updating `preferred_language`,
 * `default_currency`, and `timezone`... via Settings menu." Each field is
 * validated against the SAME real source of truth already used elsewhere in
 * this codebase (never a duplicated/invented enum): `language` against
 * `toDetectedLanguage` (the identical uz/ru/en check every reply-language
 * resolution already uses), `currency` against the real, seeded
 * `CurrencyRepository.isSupported`, `timezone` against `isValidIanaTimezone`
 * (§7.3.7's "valid IANA timezone identifier" requirement).
 */
@Injectable()
export class UpdateUserProfileUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
  ) {}

  async execute(
    userId: string,
    field: UpdateUserProfileField,
    value: string,
  ): Promise<UpdateUserProfileOutcome> {
    switch (field) {
      case 'language': {
        const language = toDetectedLanguage(value);
        if (language === null) {
          return { kind: 'invalid_value' };
        }
        const user = await this.userRepository.updateProfile(userId, {
          preferredLanguage: language,
        });
        return { kind: 'updated', user };
      }
      case 'currency': {
        const supported = await this.currencyRepository.isSupported(value);
        if (!supported) {
          return { kind: 'invalid_value' };
        }
        const user = await this.userRepository.updateProfile(userId, { defaultCurrency: value });
        return { kind: 'updated', user };
      }
      case 'timezone': {
        if (!isValidIanaTimezone(value)) {
          return { kind: 'invalid_value' };
        }
        const user = await this.userRepository.updateProfile(userId, { timezone: value });
        return { kind: 'updated', user };
      }
      default: {
        const exhaustiveCheck: never = field;
        return exhaustiveCheck;
      }
    }
  }
}
