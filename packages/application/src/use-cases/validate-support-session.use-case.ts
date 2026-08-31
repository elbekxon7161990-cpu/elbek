import { Inject, Injectable } from '@nestjs/common';
import type { SupportSession, SupportSessionRepository } from '@afa/domain';
import { SUPPORT_SESSION_REPOSITORY } from '@afa/domain';

import { SupportSessionInvalidError } from '../errors/support-session-invalid.error';

export interface ValidateSupportSessionInput {
  sessionId: string;
  callerAdminId: string;
}

/**
 * TASK-SEC-006 — the per-request check behind `SupportSessionGuard`
 * (apps/api). A support session is only ever usable by the SAME agent who
 * opened it — cross-identity isolation: a different admin presenting a
 * valid session id they don't own is rejected exactly like an
 * unknown/expired/closed session, no distinguishing shape.
 */
@Injectable()
export class ValidateSupportSessionUseCase {
  constructor(
    @Inject(SUPPORT_SESSION_REPOSITORY) private readonly sessions: SupportSessionRepository,
  ) {}

  async execute(input: ValidateSupportSessionInput): Promise<SupportSession> {
    const session = await this.sessions.findActiveById(input.sessionId, new Date());
    if (!session || session.agentAdminId !== input.callerAdminId) {
      throw new SupportSessionInvalidError();
    }
    return session;
  }
}
