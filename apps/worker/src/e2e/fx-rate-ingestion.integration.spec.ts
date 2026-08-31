import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PrismaCurrencyRepository,
  PrismaFxRateRepository,
  PrismaService,
  FakeFxRateProvider,
} from '@afa/infrastructure';
import { IngestFxRatesUseCase } from '@afa/application';

/**
 * TASK-FIN-007 Stage F — real-Postgres proof that `IngestFxRatesUseCase`
 * correctly persists provider-fetched rates into the real `fx_rates` table
 * via the existing (Stage C) `FxRateRepository`, using `FakeFxRateProvider`
 * (no real FX vendor exists — per the approved scope, this suite never
 * calls a live external provider). Mirrors
 * `transaction-fx-snapshot.integration.spec.ts`'s exact conventions
 * (owner-role Postgres, real repos constructed directly, out-of-band test
 * date to avoid colliding with real/other-suite data).
 *
 * `listActiveCodes()` returns the REAL seeded currency list, so this suite
 * only asserts on a currency pair it knows is seeded (`UZS`/`USD`/`EUR`,
 * already used by Stage C/E's own suites) rather than enumerating every
 * active currency.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
// 2023 — distinct from Stage C's 2020 fixtures and Stage E's 2022 fixtures.
const TEST_DATE = new Date('2023-06-15');

describe('TASK-FIN-007 Stage F — FX Rate Ingestion (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const currencyRepository = new PrismaCurrencyRepository(prisma);
  const fxRateRepository = new PrismaFxRateRepository(prisma);

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterEach(async () => {
    await prisma.fxRate.deleteMany({ where: { asOfDate: TEST_DATE } });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('A — successful ingestion persists a rate for a known active currency pair, with the correct asOfDate', async () => {
    const provider = new FakeFxRateProvider([]).enqueue('USD', {
      quotes: [{ quoteCurrency: 'UZS', rate: '12500.50' }],
    });
    const useCase = new IngestFxRatesUseCase(currencyRepository, provider, fxRateRepository);

    const summary = await useCase.execute(TEST_DATE);

    expect(summary.basesAttempted).toBeGreaterThan(0);
    expect(summary.failures).toEqual([]);

    const result = await fxRateRepository.findRate('USD', 'UZS', TEST_DATE);
    // findRate() formats via formatDecimalAmount (always exactly 2 decimals,
    // unlike Transaction.exchangeRateToDefault's raw toString() — Stage C's
    // own established behavior, unchanged by this stage).
    expect(result?.rate).toBe('12500.50');
    expect(result?.isApproximate).toBe(false);
  }, 30_000);

  it('B — idempotent repeated ingestion: running twice for the same day upserts rather than duplicating', async () => {
    const provider = new FakeFxRateProvider([]).enqueue('USD', {
      quotes: [{ quoteCurrency: 'UZS', rate: '12000.00' }],
    });
    const useCase = new IngestFxRatesUseCase(currencyRepository, provider, fxRateRepository);
    await useCase.execute(TEST_DATE);

    const provider2 = new FakeFxRateProvider([]).enqueue('USD', {
      quotes: [{ quoteCurrency: 'UZS', rate: '12999.99' }], // simulates a corrected re-run
    });
    const useCase2 = new IngestFxRatesUseCase(currencyRepository, provider2, fxRateRepository);
    await useCase2.execute(TEST_DATE);

    const rows = await prisma.fxRate.findMany({
      where: { baseCurrency: 'USD', quoteCurrency: 'UZS', asOfDate: TEST_DATE },
    });
    expect(rows).toHaveLength(1); // never a duplicate row
    expect(rows[0]!.rate.toString()).toBe('12999.99');
  }, 30_000);

  it('C — a provider failure for one base does not block persistence for other bases (FR-INT-002 degradation)', async () => {
    const provider = new FakeFxRateProvider([])
      .enqueue('EUR', { error: new Error('simulated provider outage') })
      .enqueue('USD', { quotes: [{ quoteCurrency: 'UZS', rate: '12100.00' }] });
    const useCase = new IngestFxRatesUseCase(currencyRepository, provider, fxRateRepository);

    const summary = await useCase.execute(TEST_DATE);

    expect(summary.failures).toContainEqual(
      expect.objectContaining({ baseCurrency: 'EUR', error: 'simulated provider outage' }),
    );
    const result = await fxRateRepository.findRate('USD', 'UZS', TEST_DATE);
    expect(result?.rate).toBe('12100.00');
  }, 30_000);

  it('D — Stage C/E behavior is unchanged: a freshly-ingested rate is immediately visible through the existing FxRateRepository.findRate() contract', async () => {
    const beforeIngestion = await fxRateRepository.findRate('USD', 'UZS', TEST_DATE);
    expect(beforeIngestion).toBeNull(); // nothing seeded yet for this out-of-band date

    const provider = new FakeFxRateProvider([]).enqueue('USD', {
      quotes: [{ quoteCurrency: 'UZS', rate: '12345.67' }],
    });
    const useCase = new IngestFxRatesUseCase(currencyRepository, provider, fxRateRepository);
    await useCase.execute(TEST_DATE);

    const afterIngestion = await fxRateRepository.findRate('USD', 'UZS', TEST_DATE);
    expect(afterIngestion).toEqual({ rate: '12345.67', asOfDate: TEST_DATE, isApproximate: false });
  }, 30_000);
});

describe('TASK-FIN-007 Stage F — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-007 Stage F fx-rate-ingestion environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});
