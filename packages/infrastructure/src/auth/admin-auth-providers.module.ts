import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import {
  BREACHED_PASSWORD_CHECKER,
  PASSWORD_HASHER,
  SECRET_STORE,
  TOTP_PROVIDER,
} from '@afa/domain';

import { Argon2PasswordHasher } from './argon2-password-hasher';
import { LocalEnvelopeSecretStore } from './local-envelope-secret-store';
import { NoOpBreachedPasswordChecker } from './no-op-breached-password-checker';
import { OtplibTotpProvider } from './otplib-totp-provider';

/**
 * TASK-AUTH-002 — composition-root binding for every admin-auth provider
 * port. `PASSWORD_HASHER`/`TOTP_PROVIDER` bind real, production-appropriate
 * adapters unconditionally (Argon2id, RFC 6238 TOTP — no vendor/provider
 * decision was open for either). `SECRET_STORE`/`BREACHED_PASSWORD_CHECKER`
 * bind the interim adapters this task's own audit determined were the
 * correct response to an unresolved provider decision (see
 * `LocalEnvelopeSecretStore`/`NoOpBreachedPasswordChecker`'s own doc
 * comments) — logged loudly on every startup, the same disclosure pattern
 * `EnvironmentBlockedProvidersModule` already established in this codebase
 * for exactly this class of gap, so the condition is never silently
 * invisible in production.
 */
@Global()
@Module({
  providers: [
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: TOTP_PROVIDER, useClass: OtplibTotpProvider },
    { provide: SECRET_STORE, useClass: LocalEnvelopeSecretStore },
    { provide: BREACHED_PASSWORD_CHECKER, useClass: NoOpBreachedPasswordChecker },
  ],
  exports: [PASSWORD_HASHER, TOTP_PROVIDER, SECRET_STORE, BREACHED_PASSWORD_CHECKER],
})
export class AdminAuthProvidersModule implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthProvidersModule.name);

  onModuleInit(): void {
    this.logger.warn(
      'AdminAuthProvidersModule is active: SECRET_STORE is bound to LocalEnvelopeSecretStore ' +
        '(interim AES-256-GCM envelope encryption — NOT a dedicated secrets manager per FR-SCR-M-001; ' +
        'requires MFA_SECRET_ENCRYPTION_KEY, a locally-held key, until a real secrets-manager adapter ' +
        'is chosen and built) and BREACHED_PASSWORD_CHECKER is bound to NoOpBreachedPasswordChecker ' +
        '(the §7.1.8 breached-password check is NOT actually enforced yet — always resolves false — ' +
        'pending an explicit provider decision). Both must be REPLACED, never silently relied upon, ' +
        'before production go-live.',
    );
  }
}
