import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Admin, AdminRepository, AdminSessionRepository } from '@afa/domain';
import {
  ADMIN_REPOSITORY,
  ADMIN_SESSION_IDLE_TIMEOUT_MS,
  ADMIN_SESSION_REPOSITORY,
} from '@afa/domain';

import { AdminSessionInvalidError } from '../errors/admin-session-invalid.error';

/**
 * TASK-AUTH-002 — the per-request check behind every protected route
 * (`AdminSessionGuard`, apps/api). Re-validates the owning admin's status on
 * every call (§7.10.2's Failure-Mode table: "Admin session token valid but
 * the admin account was deactivated mid-session... re-validates account
 * status on every privileged action, not only at login"), enforces both
 * halves of NFR-AUTH-002 (idle <=12h via `lastActiveAt`, absolute <=24h via
 * `expiresAt`, both already excluded by `findActiveByTokenHash`'s own
 * `expiresAt > now` filter for the absolute half), and revokes on any
 * failure it detects so the same borderline token cannot be retried into
 * validity.
 */
@Injectable()
export class ValidateAdminSessionUseCase {
  constructor(
    @Inject(ADMIN_SESSION_REPOSITORY) private readonly sessions: AdminSessionRepository,
    @Inject(ADMIN_REPOSITORY) private readonly admins: AdminRepository,
  ) {}

  async execute(rawToken: string): Promise<Admin> {
    const now = new Date();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const session = await this.sessions.findActiveByTokenHash(tokenHash, now);
    if (!session) {
      throw new AdminSessionInvalidError();
    }

    const idleMs = now.getTime() - session.lastActiveAt.getTime();
    if (idleMs > ADMIN_SESSION_IDLE_TIMEOUT_MS) {
      await this.sessions.revoke(session.id, now);
      throw new AdminSessionInvalidError();
    }

    const admin = await this.admins.findById(session.adminId);
    if (!admin || admin.status !== 'active') {
      await this.sessions.revoke(session.id, now);
      throw new AdminSessionInvalidError();
    }

    await this.sessions.touchLastActive(session.id, now);
    return admin;
  }
}
