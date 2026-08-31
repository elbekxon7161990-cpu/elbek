import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AdminElevationNotEligibleError,
  AdminElevationRequestInvalidError,
  ApproveAdminElevationUseCase,
  RequestAdminElevationUseCase,
} from '@afa/application';
import type { RequestAdminElevationResult } from '@afa/application';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import type { AuthenticatedAdminRequest } from '../admin-auth/admin-session.guard';
import { RequireSuperAdminGuard } from './require-super-admin.guard';

/**
 * TASK-AUTH-005 — thin presentation layer only (no business logic — every
 * decision is made by the use cases this controller calls into). Both
 * application-layer errors map to the same generic 403, per this task's
 * explicit "no distinguishing shape" instruction.
 *
 * `@Inject(SomeClass)` explicit throughout — the established AUTH-002
 * workspace-package-boundary DI lesson, applied proactively here rather
 * than rediscovered.
 */
@ApiTags('rbac')
@Controller('admin/rbac/elevation-requests')
export class AdminElevationController {
  constructor(
    @Inject(RequestAdminElevationUseCase)
    private readonly requestElevation: RequestAdminElevationUseCase,
    @Inject(ApproveAdminElevationUseCase)
    private readonly approveElevation: ApproveAdminElevationUseCase,
  ) {}

  /**
   * Self-request only — `targetAdminId` is always the authenticated
   * caller's own id (§16.10.2/3: no "nominate a different admin" flow is
   * specified anywhere in the PRD, so none is built here).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async request(@Req() request: AuthenticatedAdminRequest): Promise<RequestAdminElevationResult> {
    try {
      return await this.requestElevation.execute(request.admin.id);
    } catch (error) {
      if (error instanceof AdminElevationNotEligibleError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  /**
   * `RequireSuperAdminGuard` composed AFTER `AdminSessionGuard` — a valid
   * authenticated session alone is not sufficient; the caller must also
   * currently hold `super_admin`. "An admin cannot elevate themselves" is
   * enforced inside `ApproveAdminElevationUseCase` itself, with the same
   * generic outward rejection as every other invalid-request reason.
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard, RequireSuperAdminGuard)
  async approve(@Param('id') id: string, @Req() request: AuthenticatedAdminRequest): Promise<void> {
    try {
      await this.approveElevation.execute({
        requestId: id,
        approverAdminId: request.admin.id,
        approverRole: request.admin.role,
        ipAddress: request.ip ?? null,
      });
    } catch (error) {
      if (error instanceof AdminElevationRequestInvalidError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }
}
