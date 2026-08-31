import type {
  SupportSessionElevationRepository,
  SupportSessionElevationRequest,
} from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportSessionElevationInvalidError } from '../errors/support-session-elevation-invalid.error';
import { RequireElevatedSupportSessionUseCase } from './require-elevated-support-session.use-case';

describe('RequireElevatedSupportSessionUseCase', () => {
  let elevations: { findCurrentlyElevated: ReturnType<typeof vi.fn> };
  let useCase: RequireElevatedSupportSessionUseCase;

  beforeEach(() => {
    elevations = { findCurrentlyElevated: vi.fn() };
    useCase = new RequireElevatedSupportSessionUseCase(
      elevations as unknown as SupportSessionElevationRepository,
    );
  });

  it('resolves without throwing when the session is currently elevated', async () => {
    elevations.findCurrentlyElevated.mockResolvedValue({
      id: 'elev-1',
    } as SupportSessionElevationRequest);

    await expect(useCase.execute('session-1')).resolves.toBeUndefined();
  });

  it('rejects generically when the session is not currently elevated', async () => {
    elevations.findCurrentlyElevated.mockResolvedValue(null);

    await expect(useCase.execute('session-1')).rejects.toBeInstanceOf(
      SupportSessionElevationInvalidError,
    );
  });
});
