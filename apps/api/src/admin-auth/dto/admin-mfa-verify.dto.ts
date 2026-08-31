import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class AdminMfaVerifyDto {
  @ApiProperty()
  @IsString()
  challengeToken!: string;

  /** RFC 6238 default — 6 digits. */
  @ApiProperty()
  @IsString()
  @Length(6, 6)
  code!: string;
}
