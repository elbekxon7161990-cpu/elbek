import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GenerateDashboardModule, GenerateDashboardUseCase } from '@afa/application';
import {
  BUDGET_REPOSITORY,
  DEBT_REPOSITORY,
  DRAFT_REPOSITORY,
  REPORT_QUERY_REPOSITORY,
  USER_REPOSITORY,
} from '@afa/domain';
import {
  BudgetRepositoryModule,
  DebtRepositoryModule,
  DraftRepositoryModule,
  ReportQueryRepositoryModule,
  UserRepositoryModule,
} from '@afa/infrastructure';

/**
 * TASK-REP-004 — real NestJS DI resolution proof, mirroring
 * `generate-report-di.integration.spec.ts`'s own approach exactly: isolates
 * the module graph `TelegramBotModule` now wires for `/dashboard`
 * (`GenerateDashboardModule` + `UserRepositoryModule` +
 * `ReportQueryRepositoryModule` + `BudgetRepositoryModule` +
 * `DebtRepositoryModule` + `DraftRepositoryModule`) rather than bootstrapping
 * the full `TelegramBotModule`/`AppModule`. Every module/provider here is
 * the REAL production one — no mocks, no fakes.
 *
 * `.compile()` alone (no `.init()`) proves provider RESOLUTION — NestJS must
 * construct every provider's real instance to build the graph — without
 * running `OnModuleInit` lifecycle hooks, so this proves the WIRING is
 * correct, not that a live query succeeds (already covered by this repo's
 * real-Postgres repository integration suites and the use case's own unit
 * spec).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

describe('Dashboard DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves GenerateDashboardUseCase with all five repository tokens live, using the real production modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        GenerateDashboardModule,
        UserRepositoryModule,
        ReportQueryRepositoryModule,
        BudgetRepositoryModule,
        DebtRepositoryModule,
        DraftRepositoryModule,
      ],
    }).compile();

    const useCase = moduleRef.get(GenerateDashboardUseCase);
    expect(useCase).toBeInstanceOf(GenerateDashboardUseCase);

    expect(moduleRef.get(USER_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(REPORT_QUERY_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(BUDGET_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(DEBT_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(DRAFT_REPOSITORY)).toBeDefined();

    await moduleRef.close();
  }, 30_000);
});
