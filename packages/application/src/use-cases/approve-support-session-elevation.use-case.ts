import { Inject, Injectable } from '@nestjs/common';
import type { SupportSessionElevationRepository, SupportSessionRepository } from '@afa/domain';
import { SUPPORT_SESSION_ELEVATION_REPOSITORY, SUPPORT_SESSION_REPOSITORY } from '@afa/domain';

import { SupportSessionElevationInvalidError } from '../errors/support-session-elevation-invalid.error';

export interface ApproveSupportSessionElevationInput {
  requestId: string;
  approverAdminId: string;
  /** Must be `super_admin` (project decision — the same ceiling role AUTH-005's own admin->super_admin grant requires). */
  approverRole: 'support_agent' | 'admin' | 'super_admin';
}

/**
 * TASK-SEC-006 — the approver side of §11.7.2's `Active` -> `Elevated`
 * approval flow (AC-SEC-001's "a second approver's grant"). Every
 * rejection reason (wrong role, self-elevation, unknown/expired/resolved
 * request, the underlying support session no longer active, or a lost
 * atomic-consume race) throws the SAME generic error.
 */
@Injectable()
export class ApproveSupportSessionElevationUseCase {
  constructor(
    @Inject(SUPPORT_SESSION_ELEVATION_REPOSITORY)
    private readonly elevations: SupportSessionElevationRepository,
    @Inject(SUPPORT_SESSION_REPOSITORY) private readonly sessions: SupportSessionRepository,
  ) {}

  async execute(input: ApproveSupportSessionElevationInput): Promise<void> {
    if (input.approverRole !== 'super_admin') {
      throw new SupportSessionElevationInvalidError();
    }

    const now = new Date();
    const request = await this.elevations.findPendingById(input.requestId, now);
    if (!request) {
      throw new SupportSessionElevationInvalidError();
    }

    // The underlying session must still be active — an elevation can never
    // outlive the support session that authorized it (FR-SEC-013).
    const session = await this.sessions.findActiveById(request.supportSessionId, now);
    if (!session) {
      throw new SupportSessionElevationInvalidError();
    }

    // "An admin cannot elevate themselves" — same hard rule as AUTH-005.
    if (session.agentAdminId === input.approverAdminId) {
      throw new SupportSessionElevationInvalidError();
    }

    const granted = await this.elevations.grant({
      requestId: request.id,
      supportSessionId: session.id,
      targetUserId: session.targetUserId,
      approverAdminId: input.approverAdminId,
      now,
    });
    if (!granted) {
      throw new SupportSessionElevationInvalidError();
    }
  }
}
