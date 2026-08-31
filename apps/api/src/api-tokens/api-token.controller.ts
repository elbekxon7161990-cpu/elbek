import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApiTokenNotFoundError,
  InvalidApiTokenScopeError,
  InvalidRefreshTokenError,
  IssueApiTokenUseCase,
  RefreshApiTokenUseCase,
  RevokeApiTokenUseCase,
} from '@afa/application';
import type { IssueApiTokenResult, RefreshApiTokenResult } from '@afa/application';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import type { AuthenticatedAdminRequest } from '../admin-auth/admin-session.guard';
import { IssueApiTokenDto } from './dto/issue-api-token.dto';
import { RefreshApiTokenDto } from './dto/refresh-api-token.dto';
import { ApiTokenGuard } from './api-token.guard';
import type { AuthenticatedApiTokenRequest } from './api-token.guard';

/**
 * TASK-AUTH-003 — thin presentation layer only (no business logic). Issuance
 * and revocation are admin-guarded (never self-service, per FR-AUTH-005 /
 * §7.7.4's Issuance row); refresh authenticates via the presented refresh
 * token itself, the same way `AdminMfaVerificationUseCase` never requires a
 * prior Bearer session to complete step 2 of admin login.
 */
@ApiTags('api-tokens')
@Controller('admin/api-tokens')
export class ApiTokenController {
  constructor(
    @Inject(IssueApiTokenUseCase) private readonly issueApiToken: IssueApiTokenUseCase,
    @Inject(RefreshApiTokenUseCase) private readonly refreshApiToken: RefreshApiTokenUseCase,
    @Inject(RevokeApiTokenUseCase) private readonly revokeApiToken: RevokeApiTokenUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async issue(
    @Body() dto: IssueApiTokenDto,
    @Req() _request: AuthenticatedAdminRequest,
  ): Promise<IssueApiTokenResult> {
    try {
      return await this.issueApiToken.execute({
        clientIdentifier: dto.clientIdentifier,
        scope: dto.scope,
        rateLimitPerMinute: dto.rateLimitPerMinute,
      });
    } catch (error) {
      if (error instanceof InvalidApiTokenScopeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshApiTokenDto): Promise<RefreshApiTokenResult> {
    try {
      return await this.refreshApiToken.execute({ refreshToken: dto.refreshToken });
    } catch (error) {
      if (error instanceof InvalidRefreshTokenError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async revoke(@Param('id') id: string, @Req() _request: AuthenticatedAdminRequest): Promise<void> {
    try {
      await this.revokeApiToken.execute({ apiTokenId: id });
    } catch (error) {
      if (error instanceof ApiTokenNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  /**
   * Minimal protected route (this task's DoD proof point, same role
   * `GET /admin/auth/me` played for AUTH-002): proves an access token
   * genuinely gates access and that revocation takes effect immediately.
   */
  @Get('whoami')
  @ApiBearerAuth()
  @UseGuards(ApiTokenGuard)
  whoami(@Req() request: AuthenticatedApiTokenRequest): {
    clientIdentifier: string;
    scope: string[];
  } {
    return { clientIdentifier: request.apiToken.clientIdentifier, scope: request.apiToken.scope };
  }
}
