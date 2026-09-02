import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** Same "cannot be opened without a justification field populated" discipline as `OpenSupportSessionDto`. */
export class BlockUserDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  justification!: string;
}
