import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * TASK-AUTH-002, step 1 of 2 (§7.7.5). `@MinLength(1)` only — the real
 * >=12-char policy (§7.1.8) is enforced at admin-creation/bootstrap time,
 * never re-validated on every login attempt (a correct 12+ char password
 * that later fails this class's own length check would be a self-inflicted
 * lockout bug, not a security control).
 */
export class AdminLoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;
}
