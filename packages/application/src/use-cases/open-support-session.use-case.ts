import { Inject, Injectable } from '@nestjs/common';
import type { SupportSessionRepository, UserRepository } from '@afa/domain';
import {
  SUPPORT_SESSION_LIFETIME_MS,
  SUPPORT_SESSION_REPOSITORY,
  USER_REPOSITORY,
} from '@afa/domain';

import { SupportSessionTargetUserNotFoundError } from '../errors/support-session-target-user-not-found.error';

export interface OpenSupportSessionInput {
  agentAdminId: string;
  targetUserId: string;
  justification: string;
}

export interface OpenSupportSessionResult {
  sessionId: string;
  expiresAt: Date;
}

/**
 * TASK-SEC-006 — §11.7.2's `Requested`->`Justified`->`Active` collapsed
 * into one atomic step (see schema.prisma's own doc comment for why): the
 * justification is required in THIS call, so nothing is ever created —
 * not even an ephemeral record — without it. Available to any
 * authenticated admin role (`support_agent`/`admin`/`super_admin` all show
 * ✅ for "open logged support session" in §11.2.6's table) — no eligibility
 * gate here, unlike `RequestAdminElevationUseCase`.
 */
@Injectable()
export class OpenSupportSessionUseCase {
  constructor(
    @Inject(SUPPORT_SESSION_REPOSITORY) private readonly sessions: SupportSessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async execute(input: OpenSupportSessionInput): Promise<OpenSupportSessionResult> {
    const targetUser = await this.users.findById(input.targetUserId);
    if (!targetUser) {
      throw new SupportSessionTargetUserNotFoundError();
    }

    const now = new Date();
    const session = await this.sessions.create({
      agentAdminId: input.agentAdminId,
      targetUserId: input.targetUserId,
      justification: input.justification,
      expiresAt: new Date(now.getTime() + SUPPORT_SESSION_LIFETIME_MS),
    });

    return { sessionId: session.id, expiresAt: session.expiresAt };
  }
}
