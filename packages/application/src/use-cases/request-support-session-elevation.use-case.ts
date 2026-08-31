import { Inject, Injectable } from '@nestjs/common';
import type { SupportSessionElevationRepository } from '@afa/domain';
import {
  SUPPORT_SESSION_ELEVATION_REPOSITORY,
  SUPPORT_SESSION_ELEVATION_REQUEST_TTL_MS,
} from '@afa/domain';

import { ValidateSupportSessionUseCase } from './validate-support-session.use-case';

export interface RequestSupportSessionElevationInput {
  sessionId: string;
  callerAdminId: string;
}

export interface RequestSupportSessionElevationResult {
  requestId: string;
  expiresAt: Date;
}

/**
 * TASK-SEC-006 — the requester side of §11.7.2's `Active` -> `Elevated`
 * approval flow. Requires an active, caller-owned support session
 * (`ValidateSupportSessionUseCase` — same cross-identity-isolation
 * enforcement as every other session action). The elevation window is
 * capped at the session's own remaining lifetime — FR-SEC-013's nesting
 * principle: never let a nested grant outlive the credential that
 * authorized it.
 */
@Injectable()
export class RequestSupportSessionElevationUseCase {
  constructor(
    @Inject(SUPPORT_SESSION_ELEVATION_REPOSITORY)
    private readonly elevations: SupportSessionElevationRepository,
    @Inject(ValidateSupportSessionUseCase)
    private readonly validateSupportSession: ValidateSupportSessionUseCase,
  ) {}

  async execute(
    input: RequestSupportSessionElevationInput,
  ): Promise<RequestSupportSessionElevationResult> {
    const session = await this.validateSupportSession.execute(input);

    const now = new Date();
    const uncappedExpiry = now.getTime() + SUPPORT_SESSION_ELEVATION_REQUEST_TTL_MS;
    const expiresAt = new Date(Math.min(uncappedExpiry, session.expiresAt.getTime()));

    const request = await this.elevations.createRequest({
      supportSessionId: session.id,
      expiresAt,
    });

    return { requestId: request.id, expiresAt: request.expiresAt };
  }
}
