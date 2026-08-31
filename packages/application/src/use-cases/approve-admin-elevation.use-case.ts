import { Inject, Injectable } from '@nestjs/common';
import type { AdminElevationRepository } from '@afa/domain';
import { ADMIN_ELEVATION_REPOSITORY } from '@afa/domain';

import { AdminElevationRequestInvalidError } from '../errors/admin-elevation-request-invalid.error';

export interface ApproveAdminElevationInput {
  requestId: string;
  approverAdminId: string;
  /** Defense-in-depth re-check — `RequireSuperAdminGuard` is the primary enforcement point (apps/api). */
  approverRole: 'support_agent' | 'admin' | 'super_admin';
  ipAddress: string | null;
}

/**
 * TASK-AUTH-005 — the approver side of the `admin` -> `super_admin`
 * elevation-approval flow (AC-SEC-001's pattern: "the elevated view/role
 * becomes accessible only after a second approver's grant and a committed
 * `audit_log` entry — never before, never without either"). Every rejection
 * reason (unknown/expired/already-resolved request, approver is the
 * request's own target, approver is not a `super_admin`, or the atomic
 * grant lost a concurrent race) throws the SAME generic error — self-
 * elevation must be indistinguishable from "this request doesn't exist" to
 * an outside observer.
 */
@Injectable()
export class ApproveAdminElevationUseCase {
  constructor(
    @Inject(ADMIN_ELEVATION_REPOSITORY) private readonly elevations: AdminElevationRepository,
  ) {}

  async execute(input: ApproveAdminElevationInput): Promise<void> {
    if (input.approverRole !== 'super_admin') {
      throw new AdminElevationRequestInvalidError();
    }

    const now = new Date();
    const request = await this.elevations.findPendingById(input.requestId, now);
    if (!request) {
      throw new AdminElevationRequestInvalidError();
    }

    // "An admin cannot elevate themselves" — the one hard rule this flow exists to enforce.
    if (request.targetAdminId === input.approverAdminId) {
      throw new AdminElevationRequestInvalidError();
    }

    const granted = await this.elevations.grant({
      requestId: request.id,
      targetAdminId: request.targetAdminId,
      approverAdminId: input.approverAdminId,
      ipAddress: input.ipAddress,
      now,
    });
    if (!granted) {
      // Lost the atomic-consume race (concurrent approval, or resolved/expired
      // between the read above and the grant attempt) — same generic error,
      // never a "someone else already approved this" leak.
      throw new AdminElevationRequestInvalidError();
    }
  }
}
