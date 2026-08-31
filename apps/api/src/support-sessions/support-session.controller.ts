import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApproveSupportSessionElevationUseCase,
  CloseSupportSessionElevationUseCase,
  CloseSupportSessionUseCase,
  OpenSupportSessionUseCase,
  RequestSupportSessionElevationUseCase,
  SupportSessionElevationInvalidError,
  SupportSessionInvalidError,
  SupportSessionTargetUserNotFoundError,
} from '@afa/application';
import type {
  OpenSupportSessionResult,
  RequestSupportSessionElevationResult,
} from '@afa/application';
import type { Request } from 'express';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import type { AuthenticatedAdminRequest } from '../admin-auth/admin-session.guard';
import { RequireSuperAdminGuard } from '../rbac/require-super-admin.guard';
import { OpenSupportSessionDto } from './dto/open-support-session.dto';
import { RequireElevatedSupportSessionGuard } from './require-elevated-support-session.guard';
import { SupportSessionGuard } from './support-session.guard';
import type { AuthenticatedSupportSessionRequest } from './support-session.guard';

/**
 * TASK-SEC-006 — thin presentation layer only. Every application-layer
 * error maps to the SAME generic rejection its own error class already
 * establishes (403 for authorization-state errors, 404 only for the
 * genuinely input-validation-shaped "target user does not exist" case —
 * the same 400-vs-401/403-vs-404 split precedent `ApiTokenController`
 * already set).
 *
 * `@Inject(SomeClass)` explicit throughout — the established AUTH-002
 * workspace-package-boundary DI lesson.
 */
@ApiTags('support-sessions')
@Controller('admin/support-sessions')
export class SupportSessionController {
  constructor(
    @Inject(OpenSupportSessionUseCase) private readonly openSession: OpenSupportSessionUseCase,
    @Inject(CloseSupportSessionUseCase) private readonly closeSession: CloseSupportSessionUseCase,
    @Inject(RequestSupportSessionElevationUseCase)
    private readonly requestElevation: RequestSupportSessionElevationUseCase,
    @Inject(ApproveSupportSessionElevationUseCase)
    private readonly approveElevation: ApproveSupportSessionElevationUseCase,
    @Inject(CloseSupportSessionElevationUseCase)
    private readonly closeElevation: CloseSupportSessionElevationUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async open(
    @Body() dto: OpenSupportSessionDto,
    @Req() request: AuthenticatedAdminRequest,
  ): Promise<OpenSupportSessionResult> {
    try {
      return await this.openSession.execute({
        agentAdminId: request.admin.id,
        targetUserId: dto.targetUserId,
        justification: dto.justification,
      });
    } catch (error) {
      if (error instanceof SupportSessionTargetUserNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async close(@Param('id') id: string, @Req() request: AuthenticatedAdminRequest): Promise<void> {
    try {
      await this.closeSession.execute({ sessionId: id, callerAdminId: request.admin.id });
    } catch (error) {
      if (error instanceof SupportSessionInvalidError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  @Post(':id/elevation-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async requestElevationForSession(
    @Param('id') id: string,
    @Req() request: AuthenticatedAdminRequest,
  ): Promise<RequestSupportSessionElevationResult> {
    try {
      return await this.requestElevation.execute({
        sessionId: id,
        callerAdminId: request.admin.id,
      });
    } catch (error) {
      if (error instanceof SupportSessionInvalidError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  /**
   * Deliberately NOT `SupportSessionGuard`-protected — the approver is a
   * DIFFERENT `super_admin`, never the session's own agent, so a guard
   * requiring caller-ownership of the session would always reject the
   * legitimate approver. `RequireSuperAdminGuard` is reused directly from
   * TASK-AUTH-005's `rbac` module — the same coarse role gate, unmodified.
   */
  @Post('elevation-requests/:requestId/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard, RequireSuperAdminGuard)
  async approve(
    @Param('requestId') requestId: string,
    @Req() request: AuthenticatedAdminRequest,
  ): Promise<void> {
    try {
      await this.approveElevation.execute({
        requestId,
        approverAdminId: request.admin.id,
        approverRole: request.admin.role,
      });
    } catch (error) {
      if (error instanceof SupportSessionElevationInvalidError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  @Post(':id/elevation-requests/:requestId/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async closeElevationForSession(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Req() request: AuthenticatedAdminRequest,
  ): Promise<void> {
    try {
      await this.closeElevation.execute({
        sessionId: id,
        elevationRequestId: requestId,
        callerAdminId: request.admin.id,
      });
    } catch (error) {
      if (
        error instanceof SupportSessionElevationInvalidError ||
        error instanceof SupportSessionInvalidError
      ) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  /**
   * Minimal protected route (this task's DoD proof point, same role
   * `GET /admin/auth/me` played for AUTH-002): proves an `Active` support
   * session genuinely gates access to a specific user's account. Returns
   * only non-sensitive, already-known identifiers — never raw financial
   * detail (that's the next route, gated one step further).
   */
  @Get(':id/summary')
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard, SupportSessionGuard)
  summary(@Req() request: Request): { sessionId: string; targetUserId: string } {
    const { supportSession } = request as unknown as AuthenticatedSupportSessionRequest;
    return { sessionId: supportSession.id, targetUserId: supportSession.targetUserId };
  }

  /**
   * Minimal protected route proving the `Elevated` sub-state genuinely
   * gates raw-detail access one step further than `Active` alone — no real
   * transaction data is exposed here (no such endpoint exists yet
   * anywhere in the Admin Panel); this is the DoD proof point only.
   */
  @Get(':id/raw-detail-proof')
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard, SupportSessionGuard, RequireElevatedSupportSessionGuard)
  rawDetailProof(@Req() request: Request): { sessionId: string; elevated: true } {
    const { supportSession } = request as unknown as AuthenticatedSupportSessionRequest;
    return { sessionId: supportSession.id, elevated: true };
  }
}
