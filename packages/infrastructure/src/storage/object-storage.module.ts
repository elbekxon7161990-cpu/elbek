import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { OBJECT_STORAGE } from '@afa/domain';
import type { ObjectStoragePort } from '@afa/domain';
import type { EnvironmentVariables } from '@afa/shared';

import { FakeObjectStorage } from './fake-object-storage';
import { SupabaseObjectStorage } from './supabase-object-storage';

const logger = new Logger('ObjectStorageModule');

/** Exported for direct unit testing of the selection/fail-fast logic without standing up a full Nest DI container — mirrors `buildLlmProvider`'s own convention exactly. */
export function buildObjectStorage(
  config: ConfigService<EnvironmentVariables, true>,
): ObjectStoragePort {
  const url = config.get('SUPABASE_STORAGE_URL', { infer: true });
  const serviceRoleKey = config.get('SUPABASE_STORAGE_SERVICE_ROLE_KEY', { infer: true });
  const bucket = config.get('SUPABASE_STORAGE_BUCKET', { infer: true });

  if (url && serviceRoleKey && bucket) {
    const client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return new SupabaseObjectStorage(client, bucket);
  }

  const allowFake = config.get('ALLOW_FAKE_OBJECT_STORAGE', { infer: true });
  if (allowFake) {
    logger.warn(
      'SUPABASE_STORAGE_URL/SUPABASE_STORAGE_SERVICE_ROLE_KEY/SUPABASE_STORAGE_BUCKET are not fully set and ALLOW_FAKE_OBJECT_STORAGE=true — binding a FAKE ObjectStoragePort. This must never be true in a production deployment.',
    );
    return new FakeObjectStorage();
  }

  // Fail loud, at startup — never silently fall back to a fake, in-memory,
  // process-local object store (same precedent as buildLlmProvider). A
  // NestJS factory provider that throws fails the whole application's
  // bootstrap.
  throw new Error(
    'OBJECT_STORAGE is not configured: SUPABASE_STORAGE_URL, SUPABASE_STORAGE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET must all be set to use the real Supabase Storage adapter, or explicitly set ALLOW_FAKE_OBJECT_STORAGE=true for local development only — never in production.',
  );
}

/**
 * TASK-AI-006 (Object Storage groundwork) — the composition root for
 * `OBJECT_STORAGE` (TASK-INFRA-010's port), mirroring `LlmProviderModule`'s
 * established real-or-explicit-fake-or-fail-fast pattern exactly. Binds the
 * real `SupabaseObjectStorage` when Supabase Storage credentials are fully
 * configured; otherwise fails startup unless `ALLOW_FAKE_OBJECT_STORAGE`
 * explicitly opts into `FakeObjectStorage` for local development.
 *
 * `SUPABASE_STORAGE_*` is a deliberately separate credential set from this
 * project's existing `DATABASE_URL`/`DIRECT_URL` (Supabase Postgres
 * connection-pooler strings) — Storage authenticates via Supabase's REST
 * API with a service-role key, an entirely different mechanism from the
 * Postgres connection string, and conflating them would make it impossible
 * to rotate one credential without touching the other. The service-role key
 * bypasses Row Level Security and is server-only: it is read once here by
 * `createClient` and never logged or included in any thrown error.
 *
 * `@Global()`, same precedent as `LlmProviderModule` — a sibling import
 * under a shared parent module does not make `OBJECT_STORAGE` visible to
 * every module that injects it otherwise.
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
export class ObjectStorageModule {}
