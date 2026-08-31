import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminLockoutState,
  AdminMfaChallengeRepository,
  AdminRepository,
  PasswordHasherPort,
} from '@afa/domain';
import {
  ADMIN_MFA_CHALLENGE_REPOSITORY,
  ADMIN_MFA_CHALLENGE_TTL_MS,
  ADMIN_REPOSITORY,
  PASSWORD_HASHER,
  isAdminCurrentlyLocked,
} from '@afa/domain';

import type { AdminLoginPasswordStepInput } from '../dto/admin-login-password-step.input';
import { InvalidAdminCredentialsError } from '../errors/invalid-admin-credentials.error';
import { applyAdminLoginFailure } from './apply-admin-login-failure';

export interface AdminLoginPasswordStepResult {
  challengeToken: string;
  expiresInSeconds: number;
}

const DUMMY_VERIFY_PLAINTEXT = 'admin-login-timing-safety-dummy-plaintext';

/**
 * TASK-AUTH-002, step 1 of 2 (§7.7.5's worked example: "submits
 * username/password, validated against the complexity policy already in
 * force"). Never returns a real session — only a short-lived MFA challenge
 * token, so a protected route genuinely cannot be reached with the password
 * alone (this task's DoD). Every failure path (unknown email, wrong
 * password, locked account, deactivated account) throws the exact same
 * `InvalidAdminCredentialsError` — explicit instruction: "must not reveal
 * whether the username exists".
 */
@Injectable()
export class AdminLoginPasswordStepUseCase {
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    @Inject(ADMIN_REPOSITORY) private readonly admins: AdminRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasherPort,
    @Inject(ADMIN_MFA_CHALLENGE_REPOSITORY)
    private readonly challenges: AdminMfaChallengeRepository,
  ) {}

  async execute(input: AdminLoginPasswordStepInput): Promise<AdminLoginPasswordStepResult> {
    const now = new Date();
    const admin = await this.admins.findByEmail(input.email);

    if (!admin || admin.status !== 'active' || !admin.mfaSecretRef) {
      await this.verifyAgainstDummyHash(input.password);
      throw new InvalidAdminCredentialsError();
    }

    const lockoutState: AdminLockoutState = {
      failedLoginAttempts: admin.failedLoginAttempts,
      failedLoginWindowStartedAt: admin.failedLoginWindowStartedAt,
      lockedUntil: admin.lockedUntil,
      lockoutCycleCount: admin.lockoutCycleCount,
    };

    if (isAdminCurrentlyLocked(lockoutState, now)) {
      // Explicit instruction: never increment while already locked, and a
      // locked account's response must be indistinguishable from any other
      // failure — still run the dummy verify so timing doesn't leak it either.
      await this.verifyAgainstDummyHash(input.password);
      throw new InvalidAdminCredentialsError();
    }

    const passwordCorrect = await this.passwordHasher.verify(input.password, admin.passwordHash);
    if (!passwordCorrect) {
      await applyAdminLoginFailure(this.admins, admin.id, lockoutState, now);
      throw new InvalidAdminCredentialsError();
    }

    const challengeToken = await this.challenges.create(admin.id, ADMIN_MFA_CHALLENGE_TTL_MS);
    return { challengeToken, expiresInSeconds: ADMIN_MFA_CHALLENGE_TTL_MS / 1000 };
  }

  /**
   * Runs a real password-hash verification against a fixed dummy hash when
   * there is no real admin row (or the row is ineligible) to compare
   * against, so response timing for "no such admin" is not measurably
   * different from "wrong password for a real admin" — explicit
   * instruction: "must not reveal whether the username exists". Memoized
   * per instance (not per call) so the dummy hash's own cost is paid once.
   */
  private async verifyAgainstDummyHash(password: string): Promise<void> {
    this.dummyHashPromise ??= this.passwordHasher.hash(DUMMY_VERIFY_PLAINTEXT);
    const dummyHash = await this.dummyHashPromise;
    await this.passwordHasher.verify(password, dummyHash);
  }
}
