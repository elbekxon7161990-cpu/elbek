import { Inject, Injectable } from '@nestjs/common';
import type {
  Admin,
  AdminRepository,
  BreachedPasswordCheckerPort,
  PasswordHasherPort,
  SecretStorePort,
  TotpProviderPort,
} from '@afa/domain';
import {
  ADMIN_REPOSITORY,
  BREACHED_PASSWORD_CHECKER,
  PASSWORD_HASHER,
  SECRET_STORE,
  TOTP_PROVIDER,
} from '@afa/domain';

import type { BootstrapAdminInput } from '../dto/bootstrap-admin.input';
import { AdminAlreadyExistsError } from '../errors/admin-already-exists.error';
import { BreachedAdminPasswordError } from '../errors/breached-admin-password.error';
import { WeakAdminPasswordError } from '../errors/weak-admin-password.error';

const MIN_PASSWORD_LENGTH = 12;

export interface BootstrapAdminResult {
  admin: Admin;
  /** `otpauth://` enrollment URI — the CLI's own responsibility to surface once to the operator, never logged. */
  otpauthUrl: string;
}

/**
 * TASK-AUTH-002 Decision 4 — controlled, operator-run provisioning (never a
 * public/self-service endpoint; no HTTP route calls this use case anywhere
 * in apps/api — only apps/api's own `admin-bootstrap` CLI script does).
 * Always provisions `super_admin` (the role ceiling, §16.10.2) — creating
 * any other role is a subsequent-admin-management concern this task's DoD
 * does not require and this use case deliberately does not build.
 * Fails safe rather than idempotently succeeding when the target admin
 * already exists (Decision 4: "idempotent or fail safely" — silently
 * no-op-ing on an existing email could mask a bootstrap re-run accidentally
 * targeting a live admin's email).
 */
@Injectable()
export class BootstrapAdminUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY) private readonly admins: AdminRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasherPort,
    @Inject(TOTP_PROVIDER) private readonly totp: TotpProviderPort,
    @Inject(SECRET_STORE) private readonly secretStore: SecretStorePort,
    @Inject(BREACHED_PASSWORD_CHECKER)
    private readonly breachedPasswordChecker: BreachedPasswordCheckerPort,
  ) {}

  async execute(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new WeakAdminPasswordError();
    }
    if (await this.breachedPasswordChecker.isBreached(input.password)) {
      throw new BreachedAdminPasswordError();
    }

    const existing = await this.admins.findByEmail(input.email);
    if (existing) {
      throw new AdminAlreadyExistsError(input.email);
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    const { secret, otpauthUrl } = this.totp.generateSecret(input.email);
    const mfaSecretRef = await this.secretStore.protect(secret);

    const admin = await this.admins.create({
      email: input.email,
      passwordHash,
      mfaSecretRef,
      role: 'super_admin',
    });

    return { admin, otpauthUrl };
  }
}
