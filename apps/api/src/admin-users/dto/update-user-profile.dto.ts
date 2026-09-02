import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * All three fields optional — the controller calls `UpdateUserProfileUseCase`
 * once per field actually present, which is the real validation authority
 * (language against `toDetectedLanguage`, currency against
 * `CurrencyRepository.isSupported`, timezone against `isValidIanaTimezone`)
 * — this DTO only enforces the request shape, not the values themselves.
 */
export class UpdateUserProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;
}
