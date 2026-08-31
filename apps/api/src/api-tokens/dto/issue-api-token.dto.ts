import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * TASK-AUTH-003 — structural checks only (non-empty strings). Scope
 * FORMAT semantics (`{resource}:{verb}`) are validated at the application
 * layer (`isValidApiTokenScope`, BR-SYS-002 confinement — business
 * validation lives in domain/application, not the controller/DTO).
 */
export class IssueApiTokenDto {
  @ApiProperty()
  @IsString()
  clientIdentifier!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  scope!: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerMinute?: number;
}
