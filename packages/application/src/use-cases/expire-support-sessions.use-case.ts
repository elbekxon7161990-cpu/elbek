import { Inject, Injectable } from '@nestjs/common';
import type { SupportSessionRepository } from '@afa/domain';
import { SUPPORT_SESSION_REPOSITORY } from '@afa/domain';

export interface ExpireSupportSessionsResult {
  expiredCount: number;
}

/**
 * TASK-SEC-006 — the worker-invoked sweep behind §11.7.2's
 * "-> Expired: session timeout." The REACTIVE check
 * (`ValidateSupportSessionUseCase`, `expiresAt > now` in the WHERE clause)
 * is what actually enforces the timeout on every request — same posture
 * as `AdminSession`/`ApiToken`/`AdminElevationRequest`, none of which use a
 * background sweep either. This sweep exists purely for audit-trail
 * clarity (§11.2.8's "must be explicitly re-opened... not silently
 * extended" — a visibly `expired_at`-stamped row is easier to reason about
 * than an implicit "just check the timestamp" inference) and consistency
 * with this codebase's own scheduled-housekeeping precedent
 * (`AccountPurgeScheduler`/`BudgetRolloverScheduler`).
 */
@Injectable()
export class ExpireSupportSessionsUseCase {
  constructor(
    @Inject(SUPPORT_SESSION_REPOSITORY) private readonly sessions: SupportSessionRepository,
  ) {}

  async execute(): Promise<ExpireSupportSessionsResult> {
    const expiredCount = await this.sessions.expireDueSessions(new Date());
    return { expiredCount };
  }
}
