import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { OBJECT_STORAGE } from '@afa/domain';

import { ObjectStorageModule } from './object-storage.module';
import { SupabaseObjectStorage } from './supabase-object-storage';

/**
 * TASK-AI-006 (Object Storage groundwork) — real NestJS DI resolution
 * proof, mirroring `account-purge-di.integration.spec.ts`'s own approach:
 * proves `OBJECT_STORAGE` resolves to a real, constructed
 * `SupabaseObjectStorage` instance through `ObjectStorageModule`'s actual
 * `useFactory` provider, not a mock standing in for the module graph.
 *
 * Deliberately configured with well-formed-but-fake `SUPABASE_STORAGE_*`
 * values so the REAL branch of `buildObjectStorage` is exercised
 * deterministically regardless of ambient environment. `.compile()` alone
 * (no `.init()`) is sufficient — `createClient()` performs no network I/O at
 * construction time, so this proves WIRING correctness, not live storage
 * behavior; real upload/download/delete behavior is proven separately by
 * `supabase-object-storage.integration.spec.ts` when real credentials are
 * present.
 */
process.env.SUPABASE_STORAGE_URL ??= 'https://project-ref.supabase.co';
process.env.SUPABASE_STORAGE_SERVICE_ROLE_KEY ??= 'test-service-role-key-for-di-resolution-only';
process.env.SUPABASE_STORAGE_BUCKET ??= 'receipts-di-test';

describe('ObjectStorageModule DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves OBJECT_STORAGE to a real SupabaseObjectStorage instance, using the real production module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), ObjectStorageModule],
    }).compile();

    const storage = moduleRef.get(OBJECT_STORAGE);
    expect(storage).toBeInstanceOf(SupabaseObjectStorage);

    await moduleRef.close();
  });
});
