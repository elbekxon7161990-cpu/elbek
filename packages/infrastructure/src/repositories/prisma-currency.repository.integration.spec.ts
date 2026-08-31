import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaCurrencyRepository } from './prisma-currency.repository';

process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

describe('PrismaCurrencyRepository (integration)', () => {
  const prisma = new PrismaService();
  const repository = new PrismaCurrencyRepository(prisma);

  beforeAll(async () => {
    await prisma.onModuleInit();
    await prisma.currency.upsert({
      where: { code: 'ZZZ' },
      create: { code: 'ZZZ', isActive: false },
      update: { isActive: false },
    });
  });

  afterAll(async () => {
    await prisma.currency.deleteMany({ where: { code: 'ZZZ' } });
    await prisma.onModuleDestroy();
  });

  it('reports a seeded, active currency as supported (FR-EXP-003)', async () => {
    await expect(repository.isSupported('UZS')).resolves.toBe(true);
  });

  it('reports an inactive currency as not supported', async () => {
    await expect(repository.isSupported('ZZZ')).resolves.toBe(false);
  });

  it('reports a non-existent currency code as not supported', async () => {
    await expect(repository.isSupported('XXX')).resolves.toBe(false);
  });

  it('listActiveCodes() includes a known-active seeded currency and excludes the inactive test fixture (TASK-FIN-007 Stage F)', async () => {
    const codes = await repository.listActiveCodes();
    expect(codes).toContain('UZS');
    expect(codes).not.toContain('ZZZ');
  });
});
