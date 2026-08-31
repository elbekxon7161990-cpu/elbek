import { InvalidFxRateError } from '@afa/domain';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PrismaFxRateRepository } from './prisma-fx-rate.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-007 (Stage C) — real-Postgres proof for `PrismaFxRateRepository`.
 * Owner-role connection, matching every real-Postgres suite in this
 * package. `FxRate` is NOT RLS-protected (pure global reference data), so
 * no `runWithUserContext` wrapping is used anywhere here, unlike every
 * other real-Postgres suite this task session has written.
 *
 * Per the approved scope decision (point 5): this suite seeds `fx_rates`
 * directly (the same deterministic-seed convention already used for every
 * other table this session) rather than calling a live external FX
 * provider — no such provider is configured in this environment (Stage F
 * builds the ingestion mechanism itself; no live-vendor call is attempted
 * or claimed here).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
// A currency pair + date range far outside any real application data
// (year 2020) — `fx_rates` is global, shared, unscoped reference data (no
// per-test user to isolate by), so a deliberately out-of-band date range
// minimizes any risk of colliding with real or other-test data ever
// written to this shared Supabase table.
const BASE = 'USD';
const QUOTE = 'UZS';

describe('PrismaFxRateRepository (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const fxRateRepository = new PrismaFxRateRepository(prisma);

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterEach(async () => {
    await prisma.fxRate.deleteMany({
      where: {
        baseCurrency: BASE,
        quoteCurrency: QUOTE,
        asOfDate: { gte: new Date('2020-01-01'), lt: new Date('2020-02-01') },
      },
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('A — recordRate() + findRate() exact-date round trip, never flagged approximate', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12500.75',
      asOfDate: new Date('2020-01-10'),
      source: 'test-seed',
    });

    const result = await fxRateRepository.findRate(BASE, QUOTE, new Date('2020-01-10'));
    expect(result?.rate).toBe('12500.75');
    expect(result?.isApproximate).toBe(false);
    expect(result?.asOfDate.toISOString().slice(0, 10)).toBe('2020-01-10');
  });

  it('B — findRate() falls back to the most recent PRIOR rate and flags it approximate (FR-FIN-029)', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12000.00',
      asOfDate: new Date('2020-01-05'),
    });

    // No rate recorded for 2020-01-08 — must fall back to 2020-01-05's rate.
    // TASK-FIN-008 (precision-bug fix): `rate` is now bare `Decimal#toString()`
    // (never `formatDecimalAmount`, which would incorrectly force/truncate
    // to 2 decimals for an up-to-8-decimal field) — trailing zeros trimmed,
    // per this repository's own long-documented, now-actually-correct
    // contract for this field.
    const result = await fxRateRepository.findRate(BASE, QUOTE, new Date('2020-01-08'));
    expect(result?.rate).toBe('12000');
    expect(result?.isApproximate).toBe(true);
    expect(result?.asOfDate.toISOString().slice(0, 10)).toBe('2020-01-05');
  });

  it('C — findRate() returns null when no rate exists for the pair at all (never fabricates one)', async () => {
    const result = await fxRateRepository.findRate(BASE, QUOTE, new Date('2020-01-15'));
    expect(result).toBeNull();
  });

  it('D — findRate() never returns a rate dated AFTER the requested date', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '13000.00',
      asOfDate: new Date('2020-01-20'),
    });

    // Requesting a date BEFORE the only recorded rate -> no eligible rate exists.
    const result = await fxRateRepository.findRate(BASE, QUOTE, new Date('2020-01-10'));
    expect(result).toBeNull();
  });

  it('E — recordRate() is idempotent: recording the same (base, quote, date) twice updates rather than erroring or duplicating', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12100.00',
      asOfDate: new Date('2020-01-12'),
    });
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '12200.00', // corrected/refreshed value
      asOfDate: new Date('2020-01-12'),
    });

    // TASK-FIN-008 (precision-bug fix): trailing-zero-trimmed, see test B's
    // own comment for why this is now the correct expectation.
    const result = await fxRateRepository.findRate(BASE, QUOTE, new Date('2020-01-12'));
    expect(result?.rate).toBe('12200');

    const rows = await prisma.fxRate.findMany({
      where: { baseCurrency: BASE, quoteCurrency: QUOTE, asOfDate: new Date('2020-01-12') },
    });
    expect(rows).toHaveLength(1); // never a duplicate row
  });

  it('F — recordRate() validates before writing: invalid data never persists', async () => {
    await expect(
      fxRateRepository.recordRate({
        baseCurrency: BASE,
        quoteCurrency: QUOTE,
        rate: '-100',
        asOfDate: new Date('2020-01-18'),
      }),
    ).rejects.toThrow(InvalidFxRateError);

    const result = await fxRateRepository.findRate(BASE, QUOTE, new Date('2020-01-18'));
    expect(result).toBeNull();
  });

  it('G — findRate() is scoped to the exact currency pair — a rate for a different quote currency never leaks in', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: 'EUR',
      rate: '0.92',
      asOfDate: new Date('2020-01-22'),
    });

    const result = await fxRateRepository.findRate(BASE, QUOTE, new Date('2020-01-22'));
    expect(result).toBeNull();

    await prisma.fxRate.deleteMany({
      where: { baseCurrency: BASE, quoteCurrency: 'EUR', asOfDate: new Date('2020-01-22') },
    });
  });

  it('H — TASK-FIN-008 (precision-bug fix): a full 8-decimal-place rate (Decimal(18,8)) survives recordRate()/findRate() without truncation to 2 decimals', async () => {
    await fxRateRepository.recordRate({
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      rate: '0.12345678',
      asOfDate: new Date('2020-01-25'),
      source: 'test-seed',
    });

    const result = await fxRateRepository.findRate(BASE, QUOTE, new Date('2020-01-25'));
    // Before the fix, `formatDecimalAmount` was (incorrectly) applied here,
    // silently truncating this to "0.12" — the exact bug this test exists
    // to catch a regression of.
    expect(result?.rate).toBe('0.12345678');

    const row = await prisma.fxRate.findFirst({
      where: { baseCurrency: BASE, quoteCurrency: QUOTE, asOfDate: new Date('2020-01-25') },
    });
    expect(row?.rate.toString()).toBe('0.12345678');
  });
});

describe('PrismaFxRateRepository — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-007 fx-rate-repository environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});
