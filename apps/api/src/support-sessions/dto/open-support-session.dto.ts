import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MinLength } from 'class-validator';

/**
 * TASK-SEC-006 — FR-ADM-006/the task's own DoD: "cannot be opened without
 * a justification field populated." `@MinLength(1)` rejects empty/whitespace-
 * only justification at the request-shape level, before the use-case (or
 * any persistence) is ever reached.
 */
export class OpenSupportSessionDto {
  @ApiProperty()
  @IsUUID()
  targetUserId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  justification!: string;
}
