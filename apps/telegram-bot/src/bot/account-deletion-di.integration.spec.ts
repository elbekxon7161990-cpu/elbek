import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AccountDeletionModule,
  CancelAccountDeletionUseCase,
  RequestAccountDeletionUseCase,
} from '@afa/application';
import { ACCOUNT_DELETION_CONFIRMATION_REPOSITORY, USER_REPOSITORY } from '@afa/domain';
import {
  AccountDeletionConfirmationRepositoryModule,
  UserRepositoryModule,
} from '@afa/infrastructure';

/**
 * TASK-AUTH-006 — real NestJS DI resolution proof, mirroring
 * `generate-dashboard-di.integration.spec.ts`'s own approach exactly:
 * isolates the module graph `TelegramBotModule` now wires for
 * `/deleteaccount` (`AccountDeletionModule` + `UserRepositoryModule` +
 * `AccountDeletionConfirmationRepositoryModule`) rather than bootstrapping
 * the full `TelegramBotModule`/`AppModule`. Every module/provider here is
 * the REAL production one — no mocks, no fakes.
 *
 * `.compile()` alone (no `.init()`) proves provider RESOLUTION, not a live
 * Postgres/Redis connection — see this task's final report for why no
 * connection-requiring integration test was added for this narrow scope
 * (the two atomic repository methods this task added are exercised by the
 * application-layer unit tests instead, with real-Postgres coverage being
 * appropriate once the full purge orchestration — currently blocked on
 * unresolved product decisions — is built).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

describe('Account Deletion DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves RequestAccountDeletionUseCase with both repository tokens live, using the real production modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        AccountDeletionModule,
        UserRepositoryModule,
        AccountDeletionConfirmationRepositoryModule,
      ],
    }).compile();

    const useCase = moduleRef.get(RequestAccountDeletionUseCase);
    expect(useCase).toBeInstanceOf(RequestAccountDeletionUseCase);
    expect(moduleRef.get(CancelAccountDeletionUseCase)).toBeInstanceOf(CancelAccountDeletionUseCase);

    expect(moduleRef.get(USER_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ACCOUNT_DELETION_CONFIRMATION_REPOSITORY)).toBeDefined();

    await moduleRef.close();
  }, 30_000);
});
