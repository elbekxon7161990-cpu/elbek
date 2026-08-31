import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AdminSessionRepository } from '@afa/domain';
import { ADMIN_SESSION_REPOSITORY } from '@afa/domain';

import { AdminSessionInvalidError } from '../errors/admin-session-invalid.error';

/**
 * TASK-AUTH-004 — explicit, user-initiated session termination (§14.15.2's
 * "session expires or explicit logout"). Runs behind `AdminSessionGuard`, so
 * the presented token is already known-valid at the point this executes;
 * this use case still re-resolves the session by hash itself (rather than
 * trusting a session id threaded through the request) so it never depends on
 * the guard's internal contract, and re-throws the SAME generic
 * `AdminSessionInvalidError` `ValidateAdminSessionUseCase` uses if the
 * session has already vanished by the time this runs (e.g. a concurrent
 * idle-timeout revoke, or a second concurrent logout call) — logout never
 * gets a distinct error shape from any other session-invalid outcome.
 */
@Injectable()
export class AdminLogoutUseCase {
  constructor(
    @Inject(ADMIN_SESSION_REPOSITORY) private readonly sessions: AdminSessionRepository,
  ) {}

  async execute(rawToken: string): Promise<void> {
    const now = new Date();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const session = await this.sessions.findActiveByTokenHash(tokenHash, now);
    if (!session) {
      throw new AdminSessionInvalidError();
    }

    await this.sessions.revoke(session.id, now);
  }
}
