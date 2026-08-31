import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PurgeExpiredAccountsUseCase } from '@afa/application';
import {
  ACCOUNT_PURGE_NOTIFICATION_QUEUE,
  ACCOUNT_PURGE_REPOSITORY,
  OBJECT_STORAGE,
  USER_REPOSITORY,
} from '@afa/domain';
import { FakeObjectStorage, QueueModule, SupabaseObjectStorage } from '@afa/infrastructure';

import { AccountPurgeModule } from './account-purge.module';
import { AccountPurgeProcessor } from './account-purge.processor';
import { AccountPurgeScheduler } from './account-purge.scheduler';

/**
 * TASK-AUTH-006 — real NestJS DI resolution proof, mirroring
 * `account-deletion-di.integration.spec.ts`'s own approach exactly. This
 * class of test is what actually caught a real bug during this task's own
 * implementation: bundling `PurgeExpiredAccountsUseCase` into the SAME
 * application module `apps/telegram-bot` also imports broke THAT app's own
 * DI graph (it has no business needing `ACCOUNT_PURGE_REPOSITORY`) — a
 * mocked-provider unit test would never have caught that, only a real
 * `.compile()` of the actual production module tree does.
 *
 * `.compile()` alone (no `.init()`) proves provider RESOLUTION, not a live
 * Postgres/Redis connection — BullMQ's queue registration constructs
 * `ioredis` clients lazily (connect-on-first-command), so this does not
 * require a reachable Redis either.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
/**
 * TASK-AI-006 (Object Storage groundwork) — ObjectStorageBindingModule now
 * fails fast without real SUPABASE_STORAGE_* credentials (see
 * buildObjectStorage's own doc comment) or this explicit dev-only fake
 * opt-in. When real SUPABASE_STORAGE_* env vars ARE present (e.g. exported
 * before running this file directly), `buildObjectStorage` picks the real
 * branch regardless of this flag — the assertion below checks which branch
 * actually won and asserts the matching concrete class, so this one test
 * genuinely proves apps/worker's own composition root resolves
 * `SupabaseObjectStorage` when real config exists, not just "some object
 * resolved."
 */
process.env.ALLOW_FAKE_OBJECT_STORAGE ??= 'true';
const HAS_REAL_SUPABASE_STORAGE_CONFIG = Boolean(
  process.env.SUPABASE_STORAGE_URL &&
  process.env.SUPABASE_STORAGE_SERVICE_ROLE_KEY &&
  process.env.SUPABASE_STORAGE_BUCKET,
);

describe('AccountPurgeModule DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves PurgeExpiredAccountsUseCase, AccountPurgeProcessor, and AccountPurgeScheduler with every dependency token live, using the real production modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        QueueModule.forRoot(),
        AccountPurgeModule,
      ],
    }).compile();

    expect(moduleRef.get(PurgeExpiredAccountsUseCase)).toBeInstanceOf(PurgeExpiredAccountsUseCase);
    expect(moduleRef.get(AccountPurgeProcessor)).toBeInstanceOf(AccountPurgeProcessor);
    expect(moduleRef.get(AccountPurgeScheduler)).toBeInstanceOf(AccountPurgeScheduler);

    expect(moduleRef.get(USER_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ACCOUNT_PURGE_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ACCOUNT_PURGE_NOTIFICATION_QUEUE)).toBeDefined();
    // Proves the CONCRETE class, not just "something resolved": real
    // SUPABASE_STORAGE_* config (when present) must win over the
    // ALLOW_FAKE_OBJECT_STORAGE dev fallback, exactly matching
    // buildObjectStorage's own selection order.
    const objectStorage = moduleRef.get(OBJECT_STORAGE);
    if (HAS_REAL_SUPABASE_STORAGE_CONFIG) {
      expect(objectStorage).toBeInstanceOf(SupabaseObjectStorage);
      expect(objectStorage).not.toBeInstanceOf(FakeObjectStorage);
    } else {
      expect(objectStorage).toBeInstanceOf(FakeObjectStorage);
    }

    await moduleRef.close();
  }, 30_000);
});
