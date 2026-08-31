import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';

import { FakeObjectStorage } from './fake-object-storage';
import { SupabaseObjectStorage } from './supabase-object-storage';
import { buildObjectStorage } from './object-storage.module';

function makeConfig(
  values: Partial<EnvironmentVariables>,
): ConfigService<EnvironmentVariables, true> {
  return {
    get: vi.fn((key: string) => (values as Record<string, unknown>)[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('buildObjectStorage (ObjectStorageModule composition)', () => {
  it('binds the real SupabaseObjectStorage when all three SUPABASE_STORAGE_* variables are set', () => {
    const storage = buildObjectStorage(
      makeConfig({
        SUPABASE_STORAGE_URL: 'https://project-ref.supabase.co',
        SUPABASE_STORAGE_SERVICE_ROLE_KEY: 'service-role-test-key',
        SUPABASE_STORAGE_BUCKET: 'receipts',
      }),
    );

    expect(storage).toBeInstanceOf(SupabaseObjectStorage);
  });

  it('never binds FakeObjectStorage when real config is present, even if ALLOW_FAKE_OBJECT_STORAGE is also true', () => {
    const storage = buildObjectStorage(
      makeConfig({
        SUPABASE_STORAGE_URL: 'https://project-ref.supabase.co',
        SUPABASE_STORAGE_SERVICE_ROLE_KEY: 'service-role-test-key',
        SUPABASE_STORAGE_BUCKET: 'receipts',
        ALLOW_FAKE_OBJECT_STORAGE: true,
      }),
    );

    expect(storage).not.toBeInstanceOf(FakeObjectStorage);
    expect(storage).toBeInstanceOf(SupabaseObjectStorage);
  });

  it('fails loudly when config is only partially set (missing bucket), even with the other two present', () => {
    expect(() =>
      buildObjectStorage(
        makeConfig({
          SUPABASE_STORAGE_URL: 'https://project-ref.supabase.co',
          SUPABASE_STORAGE_SERVICE_ROLE_KEY: 'service-role-test-key',
        }),
      ),
    ).toThrow(/SUPABASE_STORAGE_BUCKET/);
  });

  it('binds a FakeObjectStorage when config is absent AND ALLOW_FAKE_OBJECT_STORAGE is explicitly true', () => {
    const storage = buildObjectStorage(makeConfig({ ALLOW_FAKE_OBJECT_STORAGE: true }));

    expect(storage).toBeInstanceOf(FakeObjectStorage);
  });

  it('fails loudly (throws) when config is missing and ALLOW_FAKE_OBJECT_STORAGE is not set — never silently runs a fake in production', () => {
    expect(() => buildObjectStorage(makeConfig({}))).toThrow(/SUPABASE_STORAGE/);
  });

  it('fails loudly when config is missing and ALLOW_FAKE_OBJECT_STORAGE is explicitly false', () => {
    expect(() => buildObjectStorage(makeConfig({ ALLOW_FAKE_OBJECT_STORAGE: false }))).toThrow(
      /SUPABASE_STORAGE/,
    );
  });

  it('the startup error never includes any credential value (there is none to include, but guards against a future regression)', () => {
    let message = '';
    try {
      buildObjectStorage(
        makeConfig({
          SUPABASE_STORAGE_URL: 'https://project-ref.supabase.co',
          SUPABASE_STORAGE_SERVICE_ROLE_KEY: 'super-secret-service-role-key',
        }),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('super-secret-service-role-key');
  });
});
