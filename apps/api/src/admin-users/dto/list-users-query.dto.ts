import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import type { UserStatus } from '@afa/domain';

const USER_STATUSES: readonly UserStatus[] = [
  'active',
  'deactivated',
  'pending_deletion',
  'deleted',
];

/** `ListUsersUseCase` itself clamps `limit`/`offset` again — this only rejects a malformed request shape before it's reached. */
export class ListUsersQueryDto {
  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}
