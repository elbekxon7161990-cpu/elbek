import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** Same "cannot be run without a justification field populated" discipline as `BlockUserDto`. */
export class ResetUserTransactionsDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  justification!: string;
}
