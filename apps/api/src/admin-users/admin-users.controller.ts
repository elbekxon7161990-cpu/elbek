import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  BlockUserUseCase,
  GetUserByIdUseCase,
  ListUsersUseCase,
  ResetUserTransactionsUseCase,
  UnblockUserUseCase,
  UpdateUserProfileUseCase,
} from '@afa/application';
import type { UpdateUserProfileField } from '@afa/application';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import type { AuthenticatedAdminRequest } from '../admin-auth/admin-session.guard';
import { RequireAdminOrSuperAdminGuard } from '../rbac/require-admin-or-super-admin.guard';
import { BlockUserDto } from './dto/block-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ResetUserTransactionsDto } from './dto/reset-user-transactions.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';

export interface UserSummaryDto {
  id: string;
  telegramUsername: string | null;
  displayName: string | null;
  status: string;
  createdAt: Date;
  preferredLanguage: string;
  defaultCurrency: string;
  timezone: string;
}

/**
 * Web admin panel — thin presentation layer only, same shape as
 * `SupportSessionController`. Never returns `User.telegramUserId` (a
 * `bigint`, which doesn't JSON-serialize natively, and unnecessary
 * exposure for this view).
 */
@ApiTags('admin-users')
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    @Inject(ListUsersUseCase) private readonly listUsers: ListUsersUseCase,
    @Inject(GetUserByIdUseCase) private readonly getUserById: GetUserByIdUseCase,
    @Inject(BlockUserUseCase) private readonly blockUser: BlockUserUseCase,
    @Inject(UnblockUserUseCase) private readonly unblockUser: UnblockUserUseCase,
    @Inject(ResetUserTransactionsUseCase)
    private readonly resetUserTransactions: ResetUserTransactionsUseCase,
    @Inject(UpdateUserProfileUseCase) private readonly updateUserProfile: UpdateUserProfileUseCase,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async list(@Query() query: ListUsersQueryDto): Promise<{
    users: UserSummaryDto[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const result = await this.listUsers.execute({
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
    return {
      users: result.users.map(toUserSummaryDto),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async getOne(@Param('id') id: string): Promise<UserSummaryDto> {
    const user = await this.getUserById.execute(id);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return toUserSummaryDto(user);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard, RequireAdminOrSuperAdminGuard)
  async block(
    @Param('id') id: string,
    @Body() dto: BlockUserDto,
    @Req() request: AuthenticatedAdminRequest,
  ): Promise<void> {
    const outcome = await this.blockUser.execute(id, dto.justification, request.admin.id);
    if (outcome.kind === 'not_eligible') {
      throw new ConflictException(
        `User is not eligible to be blocked (current status: ${outcome.currentStatus}).`,
      );
    }
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard, RequireAdminOrSuperAdminGuard)
  async unblock(@Param('id') id: string, @Req() request: AuthenticatedAdminRequest): Promise<void> {
    const outcome = await this.unblockUser.execute(id, request.admin.id);
    if (outcome.kind === 'not_eligible') {
      throw new ConflictException(
        `User is not eligible to be unblocked (current status: ${outcome.currentStatus}).`,
      );
    }
  }

  /**
   * Bulk-deletes (soft) every one of this user's transactions — see
   * `ResetUserTransactionsUseCase`'s own doc comment for the deliberate,
   * confirmed-with-the-product-owner consequence of also force-deleting
   * goal-linked transfers (stale `SavingsGoal.currentAmount`, no
   * reconciliation mechanism exists yet).
   */
  @Post(':id/reset-transactions')
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard, RequireAdminOrSuperAdminGuard)
  async resetTransactions(
    @Param('id') id: string,
    @Body() dto: ResetUserTransactionsDto,
    @Req() request: AuthenticatedAdminRequest,
  ): Promise<{ deletedCount: number }> {
    return this.resetUserTransactions.execute(id, dto.justification, request.admin.id);
  }

  /**
   * Calls `UpdateUserProfileUseCase` once per field actually present in the
   * body — that use case is the real validation authority for each field's
   * value (see its own doc comment); a single invalid field throws before
   * any of the request's other fields are applied, so a partially-invalid
   * request never applies a partial update.
   */
  @Patch(':id/profile')
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard, RequireAdminOrSuperAdminGuard)
  async updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<UserSummaryDto> {
    const edits: [UpdateUserProfileField, string][] = [];
    if (dto.language !== undefined) {
      edits.push(['language', dto.language]);
    }
    if (dto.currency !== undefined) {
      edits.push(['currency', dto.currency]);
    }
    if (dto.timezone !== undefined) {
      edits.push(['timezone', dto.timezone]);
    }

    let latest: UserSummaryDto | null = null;
    for (const [field, value] of edits) {
      const outcome = await this.updateUserProfile.execute(id, field, value);
      if (outcome.kind === 'invalid_value') {
        throw new BadRequestException(`Invalid value for "${field}".`);
      }
      latest = toUserSummaryDto(outcome.user);
    }

    if (latest) {
      return latest;
    }
    const user = await this.getUserById.execute(id);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return toUserSummaryDto(user);
  }
}

function toUserSummaryDto(user: {
  id: string;
  telegramUsername: string | null;
  displayName: string | null;
  status: string;
  createdAt: Date;
  preferredLanguage: string;
  defaultCurrency: string;
  timezone: string;
}): UserSummaryDto {
  return {
    id: user.id,
    telegramUsername: user.telegramUsername,
    displayName: user.displayName,
    status: user.status,
    createdAt: user.createdAt,
    preferredLanguage: user.preferredLanguage,
    defaultCurrency: user.defaultCurrency,
    timezone: user.timezone,
  };
}
