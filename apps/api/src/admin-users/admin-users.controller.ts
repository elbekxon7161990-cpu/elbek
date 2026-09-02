import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
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
  UnblockUserUseCase,
} from '@afa/application';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import type { AuthenticatedAdminRequest } from '../admin-auth/admin-session.guard';
import { RequireAdminOrSuperAdminGuard } from '../rbac/require-admin-or-super-admin.guard';
import { BlockUserDto } from './dto/block-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

export interface UserSummaryDto {
  id: string;
  telegramUsername: string | null;
  displayName: string | null;
  status: string;
  createdAt: Date;
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
}

function toUserSummaryDto(user: {
  id: string;
  telegramUsername: string | null;
  displayName: string | null;
  status: string;
  createdAt: Date;
}): UserSummaryDto {
  return {
    id: user.id,
    telegramUsername: user.telegramUsername,
    displayName: user.displayName,
    status: user.status,
    createdAt: user.createdAt,
  };
}
