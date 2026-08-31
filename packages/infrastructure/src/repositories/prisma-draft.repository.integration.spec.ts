import { randomUUID } from 'node:crypto';
import type { TransactionExtractionCandidate } from '@afa/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaTransactionRepository } from './prisma-transaction.repository';
import { PrismaDraftRepository } from './prisma-draft.repository';

process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

/**
 * `DATABASE_URL` in this repo's real (Supabase) `.env` connects as
 * `app_user` — the exact role `TransactionDraft`'s `tenant_isolation` RLS
 * policy targets (`RLS_PROTECTED_MODELS`) — and this suite deliberately
 * constructs a bare, non-DI `PrismaService` with no
 * `createRlsContextExtension` wrapping (same as every other
 * `*.integration.spec.ts` in this package), so no `app.current_user_id` is
 * ever set. Against a real Supabase database that means every write here
 * would otherwise fail with "new row violates row-level security policy"
 * even though nothing about `PrismaDraftRepository` itself is broken — the
 * production DI-composed client (`prisma.module.ts`) always carries the RLS
 * extension. `DIRECT_URL` (the Supabase project owner role) is used here
 * instead when present, matching this suite's own stated intent (verify
 * CRUD/mapping correctness as the table owner, not RLS enforcement itself —
 * see this file's header comment).
 */
const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;

const TEST_TELEGRAM_USER_ID_A = 900_000_000_401n;
const TEST_TELEGRAM_USER_ID_B = 900_000_000_402n;

function candidate(
  overrides: Partial<TransactionExtractionCandidate> = {},
): TransactionExtractionCandidate {
  return {
    intent: 'EXPENSE',
    amount: 45000,
    currency: 'UZS',
    category: 'FOOD_DINING',
    subcategory: null,
    merchant: null,
    paymentMethod: null,
    transactionDate: '2026-01-15',
    transactionTime: null,
    location: null,
    counterparty: null,
    dueDate: null,
    tags: [],
    description: 'Lunch',
    confidenceScores: {
      intent: 0.97,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
    ...overrides,
  };
}

/**
 * TASK-BOT-004 — real Postgres round-trip for `PrismaDraftRepository`
 * (В§13.5). Connects as `afa_owner` (table owner), same convention as every
 * other `*.integration.spec.ts` in this package (see
 * `prisma-transaction-audit-log.repository.integration.spec.ts`'s own
 * header) — this suite validates CRUD/mapping/composite-FK correctness, not
 * RLS *enforcement* itself (that is `rls-user-context.integration.spec.ts`'s
 * dedicated job against the `app_user` role, which already covers
 * `TransactionDraft` automatically via the same
 * `rls-context.extension.ts`/`RLS_PROTECTED_MODELS` mechanism this adapter
 * runs behind unchanged — not duplicated here). User-isolation at the
 * *query* level (the `findActiveByUserId(userId)` filter itself, independent
 * of RLS) is verified directly below.
 */
describe('PrismaDraftRepository (integration)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  // TASK-DB-010 — owner-role client, no user context established; both
  // constructor params can safely be the same client (see
  // prisma-transaction.repository.integration.spec.ts's identical note).
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const draftRepository = new PrismaDraftRepository(prisma);
  let userAId: string;
  let userBId: string;
  let categoryId: string;
  const createdDraftIds: string[] = [];
  const createdTransactionIds: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();
    const userA = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID_A },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID_A, displayName: 'BOT-004 Draft Test A' },
      update: {},
    });
    userAId = userA.id;
    const userB = await prisma.user.upsert({
      where: { telegramUserId: TEST_TELEGRAM_USER_ID_B },
      create: { telegramUserId: TEST_TELEGRAM_USER_ID_B, displayName: 'BOT-004 Draft Test B' },
      update: {},
    });
    userBId = userB.id;

    const category = await prisma.category.findFirst({
      where: { defaultType: 'expense', status: 'active' },
    });
    if (!category) {
      throw new Error('No active expense category found — run `prisma db seed` before this suite.');
    }
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.transactionDraft.deleteMany({ where: { id: { in: createdDraftIds } } });
    await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.onModuleDestroy();
  });

  it('creates a draft and reads it back with partialData/missingFields intact', async () => {
    const created = await draftRepository.create({
      id: randomUUID(),
      userId: userAId,
      partialData: candidate({ amount: null }),
      missingFields: ['amount'],
      originalText: 'spent some money on lunch',
      sourceType: 'text',
    });
    createdDraftIds.push(created.id);

    expect(created.status).toBe('pending');
    expect(created.resolvedTransactionId).toBeNull();

    const found = await draftRepository.findById(created.id);
    expect(found?.userId).toBe(userAId);
    expect(found?.partialData.amount).toBeNull();
    expect(found?.partialData.category).toBe('FOOD_DINING');
    expect(found?.missingFields).toEqual(['amount']);
    expect(found?.originalText).toBe('spent some money on lunch');
    expect(found?.sourceType).toBe('text');
  });

  it('returns null for a nonexistent draft id', async () => {
    expect(await draftRepository.findById(randomUUID())).toBeNull();
  });

  it('updateStatus marks a draft completed with a resolvedTransactionId, resolving the composite FK date', async () => {
    const draft = await draftRepository.create({
      id: randomUUID(),
      userId: userAId,
      partialData: candidate(),
      missingFields: [],
      originalText: 'spent 45000 on lunch',
      sourceType: 'text',
    });
    createdDraftIds.push(draft.id);

    const transaction = await transactionRepository.create({
      userId: userAId,
      transactionType: 'EXPENSE',
      amount: '45000',
      currency: 'UZS',
      categoryId,
      transactionDate: new Date('2026-01-15'),
      description: 'Lunch',
      originalText: 'spent 45000 on lunch',
      sourceType: 'text',
      sourceReference: draft.id,
      createdBy: 'ai',
    });
    createdTransactionIds.push(transaction.id);

    const updated = await draftRepository.updateStatus(draft.id, {
      status: 'completed',
      resolvedTransactionId: transaction.id,
    });

    expect(updated.status).toBe('completed');
    expect(updated.resolvedTransactionId).toBe(transaction.id);

    const row = await prisma.transactionDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.resolvedTransactionDate?.toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('updateStatus marks a draft abandoned without requiring a resolvedTransactionId', async () => {
    const draft = await draftRepository.create({
      id: randomUUID(),
      userId: userAId,
      partialData: candidate({ amount: null }),
      missingFields: ['amount'],
      originalText: 'spent some money',
      sourceType: 'text',
    });
    createdDraftIds.push(draft.id);

    const updated = await draftRepository.updateStatus(draft.id, { status: 'abandoned' });

    expect(updated.status).toBe('abandoned');
    expect(updated.resolvedTransactionId).toBeNull();
  });

  it("findActiveByUserId only returns the requesting user's own pending drafts (query-level isolation), most recent first", async () => {
    const draftA1 = await draftRepository.create({
      id: randomUUID(),
      userId: userAId,
      partialData: candidate({ amount: null }),
      missingFields: ['amount'],
      originalText: 'A draft 1',
      sourceType: 'text',
    });
    createdDraftIds.push(draftA1.id);
    const draftA2 = await draftRepository.create({
      id: randomUUID(),
      userId: userAId,
      partialData: candidate({ amount: null }),
      missingFields: ['amount'],
      originalText: 'A draft 2',
      sourceType: 'text',
    });
    createdDraftIds.push(draftA2.id);
    const draftB = await draftRepository.create({
      id: randomUUID(),
      userId: userBId,
      partialData: candidate({ amount: null }),
      missingFields: ['amount'],
      originalText: 'B draft',
      sourceType: 'text',
    });
    createdDraftIds.push(draftB.id);

    const activeForA = await draftRepository.findActiveByUserId(userAId);
    expect(activeForA.map((d) => d.id)).toContain(draftA1.id);
    expect(activeForA.map((d) => d.id)).toContain(draftA2.id);
    expect(activeForA.map((d) => d.id)).not.toContain(draftB.id);
    expect(activeForA.every((d) => d.userId === userAId)).toBe(true);

    const activeForB = await draftRepository.findActiveByUserId(userBId);
    expect(activeForB.map((d) => d.id)).toEqual([draftB.id]);
  });

  it('findActiveByUserId excludes completed/abandoned drafts', async () => {
    const draft = await draftRepository.create({
      id: randomUUID(),
      userId: userAId,
      partialData: candidate({ amount: null }),
      missingFields: ['amount'],
      originalText: 'will be abandoned',
      sourceType: 'text',
    });
    createdDraftIds.push(draft.id);
    await draftRepository.updateStatus(draft.id, { status: 'abandoned' });

    const active = await draftRepository.findActiveByUserId(userAId);
    expect(active.map((d) => d.id)).not.toContain(draft.id);
  });
});
