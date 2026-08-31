import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GenerateReportModule, GenerateReportUseCase } from '@afa/application';
import {
  BUDGET_REPOSITORY,
  DEBT_REPOSITORY,
  REPORT_CACHE_REPOSITORY,
  REPORT_QUERY_REPOSITORY,
} from '@afa/domain';
import {
  BudgetRepositoryModule,
  DebtRepositoryModule,
  REDIS_CLIENT,
  ReportCacheRepositoryModule,
  ReportQueryRepositoryModule,
} from '@afa/infrastructure';

/**
 * REPORT DI / COMPOSITION-ROOT WIRING — real NestJS DI resolution proof.
 *
 * Isolates exactly the module graph the "Report DI / composition-root
 * wiring" task added to `TelegramBotModule` — `GenerateReportModule` +
 * `ReportQueryRepositoryModule` + `ReportCacheRepositoryModule` + the two
 * already-existing `DebtRepositoryModule`/`BudgetRepositoryModule` — rather
 * than bootstrapping the full `TelegramBotModule`/`AppModule` (which also
 * needs `TELEGRAM_BOT_TOKEN`/`ANTHROPIC_API_KEY` and other credentials
 * wholly unrelated to this verification). Every module/provider here is the
 * REAL production one — no mocks, no fakes, no test doubles substituted for
 * any of the five modules under test.
 *
 * `Test.createTestingModule({...}).compile()` alone (no `.init()`) is
 * sufficient to prove provider RESOLUTION — NestJS must actually construct
 * every provider's real instance (running `useClass`/`useFactory`) to build
 * the graph, without running `OnModuleInit` lifecycle hooks (so
 * `PrismaService.$connect()` never runs here) — this test proves the WIRING
 * is correct, not that a live query succeeds (that is already covered by
 * this repo's existing real-Postgres integration suites for each
 * repository).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

describe('Report DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves GenerateReportUseCase with all four report-related tokens live, using the real production modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        GenerateReportModule,
        ReportQueryRepositoryModule,
        ReportCacheRepositoryModule,
        DebtRepositoryModule,
        BudgetRepositoryModule,
      ],
    }).compile();

    const useCase = moduleRef.get(GenerateReportUseCase);
    expect(useCase).toBeInstanceOf(GenerateReportUseCase);

    const reportQueryRepository = moduleRef.get(REPORT_QUERY_REPOSITORY);
    const reportCacheRepository = moduleRef.get(REPORT_CACHE_REPOSITORY);
    const debtRepository = moduleRef.get(DEBT_REPOSITORY);
    const budgetRepository = moduleRef.get(BUDGET_REPOSITORY);

    expect(reportQueryRepository).toBeDefined();
    expect(reportCacheRepository).toBeDefined();
    expect(debtRepository).toBeDefined();
    expect(budgetRepository).toBeDefined();

    // The @Optional() constructor params on GenerateReportUseCase are only
    // "optional" for tests that omit them — in this REAL DI graph they must
    // actually be populated, not silently undefined.
    expect((useCase as unknown as { debtRepository?: unknown }).debtRepository).toBeDefined();
    expect((useCase as unknown as { budgetRepository?: unknown }).budgetRepository).toBeDefined();

    await moduleRef.get(REDIS_CLIENT).quit();
    await moduleRef.close();
  }, 30_000);
});
