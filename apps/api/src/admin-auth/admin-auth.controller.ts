import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AdminLoginPasswordStepUseCase,
  AdminLogoutUseCase,
  AdminMfaVerificationUseCase,
  AdminSessionInvalidError,
  InvalidAdminCredentialsError,
  InvalidAdminMfaCodeError,
} from '@afa/application';
import type { Request } from 'express';

import { AdminMfaVerifyDto } from './dto/admin-mfa-verify.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminSessionGuard } from './admin-session.guard';
import type { AuthenticatedAdminRequest } from './admin-session.guard';

/**
 * TASK-AUTH-004 — same header-parsing shape as `AdminSessionGuard`'s own
 * private `extractBearerToken`, duplicated rather than imported so this
 * controller never depends on that guard's internals; `AdminSessionGuard`
 * has already run by the time `logout()` executes (it validated the token
 * to populate `request.admin`), this just re-reads the same header to hand
 * the raw token to `AdminLogoutUseCase`, which re-resolves the session
 * itself rather than trusting anything threaded through the request.
 */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }
  return token;
}

/**
 * TASK-AUTH-002 — thin presentation layer only (no business logic — every
 * decision is made by the use cases this controller calls into). Maps the
 * two application-layer errors to the SAME generic 401 both are designed to
 * produce, per this task's explicit instruction; never adds distinguishing
 * detail the use case itself deliberately withheld.
 *
 * `@Inject(SomeClass)` is explicit here rather than relying on bare
 * class-type constructor injection (`emitDecoratorMetadata`'s reflected
 * `design:paramtypes`) — discovered via `admin-auth-di.integration.spec.ts`'s
 * own strengthened assertions that bare class-type injection across this
 * monorepo's workspace-package boundary (`@afa/application`'s compiled
 * output) silently resolves to `undefined` inside a controller's
 * constructor under `@nestjs/testing` + Vitest's esbuild-based transform
 * (`moduleRef.get(AdminLoginPasswordStepUseCase)` succeeds independently —
 * only the wiring INTO another provider's constructor was affected).
 * Explicit `@Inject()` sidesteps reflected-metadata entirely, is strictly
 * safer for any cross-package constructor injection, and costs nothing.
 */
@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @Inject(AdminLoginPasswordStepUseCase)
    private readonly loginPasswordStep: AdminLoginPasswordStepUseCase,
    @Inject(AdminMfaVerificationUseCase)
    private readonly mfaVerification: AdminMfaVerificationUseCase,
    @Inject(AdminLogoutUseCase)
    private readonly logoutUseCase: AdminLogoutUseCase,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: AdminLoginDto,
  ): Promise<{ challengeToken: string; expiresInSeconds: number }> {
    try {
      return await this.loginPasswordStep.execute({ email: dto.email, password: dto.password });
    } catch (error) {
      if (error instanceof InvalidAdminCredentialsError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }

  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyMfa(
    @Body() dto: AdminMfaVerifyDto,
    @Req() request: Request,
  ): Promise<{ sessionToken: string; expiresAt: Date }> {
    try {
      return await this.mfaVerification.execute({
        challengeToken: dto.challengeToken,
        code: dto.code,
        ipAddress: request.ip ?? null,
      });
    } catch (error) {
      if (error instanceof InvalidAdminMfaCodeError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }

  /**
   * Minimal protected route (this task's DoD proof point: "cannot reach any
   * protected route without both factors") — returns the authenticated
   * admin's own non-sensitive identity fields, nothing else. Broader Admin
   * Panel routes are TASK-SEC-006's scope, not this task's.
   */
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  me(@Req() request: AuthenticatedAdminRequest): { id: string; email: string; role: string } {
    return { id: request.admin.id, email: request.admin.email, role: request.admin.role };
  }

  /**
   * TASK-AUTH-004 — explicit, server-side-enforced logout (§14.15.2). Guarded
   * by `AdminSessionGuard` like `me()`, so an already-invalid token never
   * reaches here at all (401 from the guard itself, same generic shape).
   * `AdminLogoutUseCase` re-resolves the session from the same header this
   * request carried and revokes it; the immediate-next request bearing the
   * same token is rejected by the guard exactly like any other invalid
   * session — no distinguishing status/shape between "revoked via logout"
   * and any other reason a session is no longer valid.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async logout(@Req() request: Request): Promise<void> {
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Invalid or expired session.');
    }
    try {
      await this.logoutUseCase.execute(token);
    } catch (error) {
      if (error instanceof AdminSessionInvalidError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }
}
