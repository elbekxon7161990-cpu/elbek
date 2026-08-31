import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OBJECT_STORAGE } from '@afa/domain';
import { buildObjectStorage } from '@afa/infrastructure';

/**
 * TASK-AUTH-006 / TASK-AI-006 (Object Storage groundwork) — binds
 * `OBJECT_STORAGE` for `apps/worker`'s own purge job.
 *
 * Previously hardcoded to `FakeObjectStorage` (in-memory, process-local,
 * REAL_PROVIDER_STATUS = ENVIRONMENT-BLOCKED — the Object Storage step of
 * the purge ran but was never verified against a real bucket). Now uses the
 * same real-or-explicit-fake-or-fail-fast factory `ObjectStorageModule`
 * uses elsewhere (`buildObjectStorage`, `@afa/infrastructure`), so the
 * purge's `deleteObjectsByPrefix` calls hit real Supabase Storage in any
 * environment where `SUPABASE_STORAGE_*` is configured. Kept as this app's
 * own thin module (rather than importing `ObjectStorageModule` directly)
 * only so `AccountPurgeModule`'s existing import graph doesn't need to
 * change — behavior is identical either way; see `buildObjectStorage`'s own
 * doc comment for the real-vs-fake selection logic.
 */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      useFactory: buildObjectStorage,
      inject: [ConfigService],
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class ObjectStorageBindingModule {}
