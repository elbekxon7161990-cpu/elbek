import { Inject, Injectable } from '@nestjs/common';
import type { AdminElevationRepository, AdminRepository } from '@afa/domain';
import {
  ADMIN_ELEVATION_REPOSITORY,
  ADMIN_ELEVATION_REQUEST_TTL_MS,
  ADMIN_REPOSITORY,
} from '@afa/domain';

import { AdminElevationNotEligibleError } from '../errors/admin-elevation-not-eligible.error';

export interface RequestAdminElevationResult {
  requestId: string;
  expiresAt: Date;
}

/**
 * TASK-AUTH-005 — the requester side of the `admin` -> `super_admin`
 * elevation-approval flow (§16.10.2/3). Self-request only (the caller
 * requests elevation for their own account — `targetAdminId` is always the
 * authenticated caller's own id, threaded through from the controller,
 * never an arbitrary admin the caller names): the PRD specifies no
 * "nominate a different admin" flow, so none is built here. "Never
 * self-service" (§16.10.2) is enforced at the GRANT step, not here — a
 * request merely opens the possibility of elevation; only a second,
 * different `super_admin`'s approval can ever complete it
 * (`ApproveAdminElevationUseCase`).
 */
@Injectable()
export class RequestAdminElevationUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY) private readonly admins: AdminRepository,
    @Inject(ADMIN_ELEVATION_REPOSITORY) private readonly elevations: AdminElevationRepository,
  ) {}

  async execute(targetAdminId: string): Promise<RequestAdminElevationResult> {
    const admin = await this.admins.findById(targetAdminId);
    // Covers both "already super_admin" (§16.10.2's ceiling — "no further
    // elevation exists") and any other role: this path is exactly and only
    // admin -> super_admin.
    if (!admin || admin.role !== 'admin') {
      throw new AdminElevationNotEligibleError();
    }

    const now = new Date();
    const request = await this.elevations.createRequest({
      targetAdminId,
      expiresAt: new Date(now.getTime() + ADMIN_ELEVATION_REQUEST_TTL_MS),
    });

    return { requestId: request.id, expiresAt: request.expiresAt };
  }
}
