import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ObjectNotFoundError, ObjectStorageUnavailableError } from '@afa/domain';

import { SupabaseObjectStorage } from './supabase-object-storage';

interface FakeBucketApi {
  upload: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
}

/** A minimal `{ arrayBuffer() }` double for what `.download()` resolves with — avoids depending on the DOM/Node `Blob` global, which this package's eslint config doesn't declare. */
function fakeBlob(bytes: Buffer): { arrayBuffer: () => Promise<ArrayBuffer> } {
  return {
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

function makeClient(bucketApi: Partial<FakeBucketApi>): {
  client: SupabaseClient;
  from: ReturnType<typeof vi.fn>;
} {
  const api: FakeBucketApi = {
    upload: vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: null, error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    ...bucketApi,
  };
  const from = vi.fn().mockReturnValue(api);
  const client = { storage: { from } } as unknown as SupabaseClient;
  return { client, from };
}

describe('SupabaseObjectStorage', () => {
  describe('putObject', () => {
    it('uploads with upsert:true and the given content type, on the configured bucket', async () => {
      const { client, from } = makeClient({});
      const storage = new SupabaseObjectStorage(client, 'receipts-bucket');

      await storage.putObject('photo/1/a.jpg', Buffer.from('jpeg-bytes'), 'image/jpeg');

      expect(from).toHaveBeenCalledWith('receipts-bucket');
      const bucketApi = from.mock.results[0]!.value as FakeBucketApi;
      expect(bucketApi.upload).toHaveBeenCalledWith('photo/1/a.jpg', Buffer.from('jpeg-bytes'), {
        contentType: 'image/jpeg',
        upsert: true,
      });
    });

    it('preserves binary data exactly (non-UTF8-safe bytes round-trip unchanged)', async () => {
      const binary = Buffer.from([0x00, 0xff, 0x10, 0x8a, 0x00, 0x01, 0xfe]);
      const { client, from } = makeClient({});
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await storage.putObject('voice/1/a.ogg', binary, 'audio/ogg');

      const bucketApi = from.mock.results[0]!.value as FakeBucketApi;
      const uploadedBytes = bucketApi.upload.mock.calls[0]![1] as Buffer;
      expect(uploadedBytes.equals(binary)).toBe(true);
    });

    it('maps an upload failure to ObjectStorageUnavailableError, never leaking the raw provider message', async () => {
      const { client } = makeClient({
        upload: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'invalid api key: sb_secret_abc123' },
        }),
      });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      let thrown: unknown;
      try {
        await storage.putObject('photo/1/a.jpg', Buffer.from('x'), 'image/jpeg');
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ObjectStorageUnavailableError);
      expect((thrown as Error).message).not.toContain('sb_secret_abc123');
    });
  });

  describe('getObject', () => {
    it('returns the exact bytes previously stored (binary preservation)', async () => {
      const binary = Buffer.from([0x00, 0xff, 0x10, 0x8a]);
      const { client } = makeClient({
        download: vi.fn().mockResolvedValue({ data: fakeBlob(binary), error: null }),
      });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      const result = await storage.getObject('photo/1/a.jpg');

      expect(result.equals(binary)).toBe(true);
    });

    it('throws ObjectNotFoundError when the provider reports a 404 statusCode', async () => {
      const { client } = makeClient({
        download: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Object not found', statusCode: '404' },
        }),
      });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await expect(storage.getObject('photo/1/missing.jpg')).rejects.toBeInstanceOf(
        ObjectNotFoundError,
      );
    });

    it('throws ObjectNotFoundError when the message says "not found" without a statusCode', async () => {
      const { client } = makeClient({
        download: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not Found' } }),
      });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await expect(storage.getObject('photo/1/missing.jpg')).rejects.toBeInstanceOf(
        ObjectNotFoundError,
      );
    });

    it('maps any other download failure to ObjectStorageUnavailableError, never leaking the raw provider message', async () => {
      const { client } = makeClient({
        download: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'network timeout while using key sb_secret_xyz', statusCode: '500' },
        }),
      });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      let thrown: unknown;
      try {
        await storage.getObject('photo/1/a.jpg');
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ObjectStorageUnavailableError);
      expect(thrown).not.toBeInstanceOf(ObjectNotFoundError);
      expect((thrown as Error).message).not.toContain('sb_secret_xyz');
    });
  });

  describe('deleteObject', () => {
    it('removes exactly the given uri, idempotently (no error surfaced by the provider on an absent key)', async () => {
      const { client, from } = makeClient({});
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await expect(storage.deleteObject('photo/1/a.jpg')).resolves.toBeUndefined();

      const bucketApi = from.mock.results[0]!.value as FakeBucketApi;
      expect(bucketApi.remove).toHaveBeenCalledWith(['photo/1/a.jpg']);
    });

    it('maps a delete failure to ObjectStorageUnavailableError', async () => {
      const { client } = makeClient({
        remove: vi.fn().mockResolvedValue({ data: null, error: { message: 'network error' } }),
      });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await expect(storage.deleteObject('photo/1/a.jpg')).rejects.toBeInstanceOf(
        ObjectStorageUnavailableError,
      );
    });
  });

  describe('deleteObjectsByPrefix', () => {
    it('lists the folder derived from the prefix (trailing slash stripped) and removes every returned file, building full paths from folder + name', async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            { id: 'id-1', name: 'a.jpg' },
            { id: 'id-2', name: 'b.jpg' },
          ],
          error: null,
        })
        .mockResolvedValueOnce({ data: [], error: null });
      const { client, from } = makeClient({ list });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await storage.deleteObjectsByPrefix('photo/1/');

      expect(list).toHaveBeenCalledWith('photo/1', { limit: 100, offset: 0 });
      const bucketApi = from.mock.results[0]!.value as FakeBucketApi;
      expect(bucketApi.remove).toHaveBeenCalledWith(['photo/1/a.jpg', 'photo/1/b.jpg']);
    });

    it('never touches a different user prefix (isolation)', async () => {
      // Only user-1's objects are ever returned by list() for the 'photo/1'
      // folder — a real Supabase Storage `list()` call is itself scoped to
      // that exact folder path, so user-2's objects (`photo/2/...`) are
      // structurally never candidates for removal here; this test proves
      // the removed paths are always built under the requested prefix only.
      const list = vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'id-1', name: 'a.jpg' }], error: null });
      const { client, from } = makeClient({ list });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await storage.deleteObjectsByPrefix('photo/1/');

      const bucketApi = from.mock.results[0]!.value as FakeBucketApi;
      const removedPaths = bucketApi.remove.mock.calls[0]![0] as string[];
      expect(removedPaths.every((path) => path.startsWith('photo/1/'))).toBe(true);
      expect(removedPaths.some((path) => path.startsWith('photo/2/'))).toBe(false);
    });

    it('paginates: keeps re-listing and deleting from the top until a page smaller than the page size comes back, never assuming one request is enough', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, name: `${i}.jpg` }));
      const list = vi
        .fn()
        .mockResolvedValueOnce({ data: fullPage, error: null })
        .mockResolvedValueOnce({ data: [{ id: 'id-100', name: '100.jpg' }], error: null });
      const remove = vi.fn().mockResolvedValue({ data: [], error: null });
      const { client } = makeClient({ list, remove });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await storage.deleteObjectsByPrefix('photo/1/');

      expect(list).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenNthCalledWith(1, 'photo/1', { limit: 100, offset: 0 });
      expect(list).toHaveBeenNthCalledWith(2, 'photo/1', { limit: 100, offset: 0 });
      expect(remove).toHaveBeenCalledTimes(2);
      expect((remove.mock.calls[0]![0] as string[]).length).toBe(100);
      expect((remove.mock.calls[1]![0] as string[]).length).toBe(1);
    });

    it('is a safe no-op when the prefix has no objects', async () => {
      const { client, from } = makeClient({
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
      });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await expect(storage.deleteObjectsByPrefix('photo/does-not-exist/')).resolves.toBeUndefined();

      const bucketApi = from.mock.results[0]!.value as FakeBucketApi;
      expect(bucketApi.remove).not.toHaveBeenCalled();
    });

    it('filters out pseudo-directory entries (id: null) before building delete paths', async () => {
      const list = vi.fn().mockResolvedValue({
        data: [
          { id: null, name: 'subfolder' },
          { id: 'id-1', name: 'a.jpg' },
        ],
        error: null,
      });
      const { client, from } = makeClient({ list });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await storage.deleteObjectsByPrefix('photo/1/');

      const bucketApi = from.mock.results[0]!.value as FakeBucketApi;
      expect(bucketApi.remove).toHaveBeenCalledWith(['photo/1/a.jpg']);
    });

    it('maps a list() failure to ObjectStorageUnavailableError', async () => {
      const { client } = makeClient({
        list: vi.fn().mockResolvedValue({ data: null, error: { message: 'network error' } }),
      });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await expect(storage.deleteObjectsByPrefix('photo/1/')).rejects.toBeInstanceOf(
        ObjectStorageUnavailableError,
      );
    });

    it('maps a bulk remove() failure to ObjectStorageUnavailableError', async () => {
      const { client } = makeClient({
        list: vi.fn().mockResolvedValue({ data: [{ id: 'id-1', name: 'a.jpg' }], error: null }),
        remove: vi.fn().mockResolvedValue({ data: null, error: { message: 'network error' } }),
      });
      const storage = new SupabaseObjectStorage(client, 'bucket');

      await expect(storage.deleteObjectsByPrefix('photo/1/')).rejects.toBeInstanceOf(
        ObjectStorageUnavailableError,
      );
    });
  });
});
