import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaCategoryRepository } from './prisma-category.repository';

process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

// TASK-FIN-006 — `categories`/`category_translations` are now RLS-protected
// (migration 20260830000000_custom_categories). This suite's own fixtures
// create NULL-`owner_user_id` ("system-style") rows directly via the ORM,
// which the new `category_owner_insert` policy correctly rejects for the
// real, RLS-restricted `app_user` role (a NULL-owner row may only be written
// by an owner/BYPASSRLS-role connection — the seed script and any future
// Admin Panel, never plain `app_user`). Connects via the owner-role
// `DIRECT_URL` when available, the same established pattern
// `undo-concurrency.integration.spec.ts` already uses for exactly this
// reason, so this suite keeps testing CRUD/mapping correctness rather than
// RLS enforcement itself (a separate, already-covered concern).
const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;

describe('PrismaCategoryRepository (integration)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const repository = new PrismaCategoryRepository(prisma, prisma);
  let activeCategoryId: string;
  let deprecatedCategoryId: string;

  beforeAll(async () => {
    await prisma.onModuleInit();
    const active = await prisma.category.create({
      data: { code: 'TEST_FIN001_ACTIVE', defaultType: 'expense', status: 'active' },
    });
    activeCategoryId = active.id;
    const deprecated = await prisma.category.create({
      data: { code: 'TEST_FIN001_DEPRECATED', defaultType: 'expense', status: 'deprecated' },
    });
    deprecatedCategoryId = deprecated.id;
  });

  afterAll(async () => {
    await prisma.category.deleteMany({
      where: { id: { in: [activeCategoryId, deprecatedCategoryId] } },
    });
    await prisma.onModuleDestroy();
  });

  it('finds an existing active category (BR-EXP-001)', async () => {
    const found = await repository.findById(activeCategoryId);
    expect(found).toEqual({ id: activeCategoryId, code: 'TEST_FIN001_ACTIVE', status: 'active' });
  });

  it('returns null for a missing category', async () => {
    await expect(repository.findById('00000000-0000-0000-0000-000000000000')).resolves.toBeNull();
  });

  it('reports a deprecated category’s status rather than hiding it (caller decides rejection)', async () => {
    const found = await repository.findById(deprecatedCategoryId);
    expect(found).toEqual({
      id: deprecatedCategoryId,
      code: 'TEST_FIN001_DEPRECATED',
      status: 'deprecated',
    });
  });

  // TASK-FIN-REAL-001 — findByCode resolves the AI candidate's stable code
  // (e.g. 'FOOD_DINING') into the UUID CreateExpenseUseCase/CreateIncomeUseCase require.
  it('finds an existing active category by its code (TASK-FIN-REAL-001)', async () => {
    const found = await repository.findByCode('TEST_FIN001_ACTIVE');
    expect(found).toEqual({ id: activeCategoryId, code: 'TEST_FIN001_ACTIVE', status: 'active' });
  });

  it('returns null for a code that does not exist', async () => {
    await expect(repository.findByCode('NOT_A_REAL_CODE')).resolves.toBeNull();
  });

  it('reports a deprecated category’s status when looked up by code', async () => {
    const found = await repository.findByCode('TEST_FIN001_DEPRECATED');
    expect(found).toEqual({
      id: deprecatedCategoryId,
      code: 'TEST_FIN001_DEPRECATED',
      status: 'deprecated',
    });
  });
});
