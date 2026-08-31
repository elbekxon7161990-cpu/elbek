import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminLockoutState,
  AdminMfaChallengeRepository,
  AdminRepository,
  AdminSessionRepository,
  SecretStorePort,
  TotpProviderPort,
} from '@afa/domain';
import {
  ADMIN_MFA_CHALLENGE_REPOSITORY,
  ADMIN_REPOSITORY,
  ADMIN_SESSION_ABSOLUTE_LIFETIME_MS,
  ADMIN_SESSION_REPOSITORY,
  SECRET_STORE,
  TOTP_PROVIDER,
  isAdminCurrentlyLocked,
} from '@afa/domain';

import type { AdminMfaVerifyInput } from '../dto/admin-mfa-verify.input';
import { InvalidAdminMfaCodeError } from '../errors/invalid-admin-mfa-code.error';
import { applyAdminLoginFailure } from './apply-admin-login-failure';

export interface AdminMfaVerifyResult {
  sessionToken: string;
  expiresAt: Date;
}

/**
 * TASK-AUTH-002, step 2 of 2 (§7.7.5): "prompted for a TOTP code... verified
 * against the agent's enrolled secret... on success, a session token is
 * issued." This is the ONLY place in the whole flow that ever issues a real
 * `AdminSession` — the DoD's "cannot reach any protected route without both
 * factors" is true precisely because no earlier step does this. Every
 * failure path throws the same generic `InvalidAdminMfaCodeError`.
 */
@Injectable()
export class AdminMfaVerificationUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY) private readonly admins: AdminRepository,
    @Inject(ADMIN_SESSION_REPOSITORY) private readonly sessions: AdminSessionRepository,
    @Inject(ADMIN_MFA_CHALLENGE_REPOSITORY)
    private readonly challenges: AdminMfaChallengeRepository,
    @Inject(TOTP_PROVIDER) private readonly totp: TotpProviderPort,
    @Inject(SECRET_STORE) private readonly secretStore: SecretStorePort,
  ) {}

  async execute(input: AdminMfaVerifyInput): Promise<AdminMfaVerifyResult> {
    const now = new Date();

    const challenge = await this.challenges.get(input.challengeToken);
    if (!challenge) {
      throw new InvalidAdminMfaCodeError();
    }

    const admin = await this.admins.findById(challenge.adminId);
    if (!admin || admin.status !== 'active' || !admin.mfaSecretRef) {
      throw new InvalidAdminMfaCodeError();
    }

    const lockoutState: AdminLockoutState = {
      failedLoginAttempts: admin.failedLoginAttempts,
      failedLoginWindowStartedAt: admin.failedLoginWindowStartedAt,
      lockedUntil: admin.lockedUntil,
      lockoutCycleCount: admin.lockoutCycleCount,
    };
    if (isAdminCurrentlyLocked(lockoutState, now)) {
      // The account may have crossed the lockout threshold between the
      // password step and this step (e.g. a concurrent brute-force attempt).
      throw new InvalidAdminMfaCodeError();
    }

    const rawSecret = await this.secretStore.reveal(admin.mfaSecretRef);
    const codeValid = await this.totp.verify(rawSecret, input.code);
    if (!codeValid) {
      // §7.1.9 — "counted toward the lockout threshold" — same threshold as
      // password-step failures (applyAdminLoginFailure is shared).
      await applyAdminLoginFailure(this.admins, admin.id, lockoutState, now);
      throw new InvalidAdminMfaCodeError();
    }

    await this.challenges.consume(input.challengeToken);
    await this.admins.resetLoginFailureState(admin.id);

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(now.getTime() + ADMIN_SESSION_ABSOLUTE_LIFETIME_MS);
    await this.sessions.create({
      adminId: admin.id,
      tokenHash,
      ipAddress: input.ipAddress,
      expiresAt,
    });

    return { sessionToken: rawToken, expiresAt };
  }
}
