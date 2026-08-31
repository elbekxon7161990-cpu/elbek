import { Inject, Injectable } from '@nestjs/common';
import type { SupportSessionRepository } from '@afa/domain';
import { SUPPORT_SESSION_REPOSITORY } from '@afa/domain';

import { SupportSessionInvalidError } from '../errors/support-session-invalid.error';
import { ValidateSupportSessionUseCase } from './validate-support-session.use-case';

export interface CloseSupportSessionInput {
  sessionId: string;
  callerAdminId: string;
}

/** TASK-SEC-006 — §11.7.2 "Active -> Closed: agent ends session." Terminal — no reopening. */
@Injectable()
export class CloseSupportSessionUseCase {
  constructor(
    @Inject(SUPPORT_SESSION_REPOSITORY) private readonly sessions: SupportSessionRepository,
    @Inject(ValidateSupportSessionUseCase)
    private readonly validateSupportSession: ValidateSupportSessionUseCase,
  ) {}

  async execute(input: CloseSupportSessionInput): Promise<void> {
    const session = await this.validateSupportSession.execute(input);

    const closed = await this.sessions.close(session.id, new Date());
    if (!closed) {
      // Lost a race against expiry/another close call — same generic error.
      throw new SupportSessionInvalidError();
    }
  }
}
