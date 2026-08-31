import { Buffer } from 'node:buffer';
import { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ObjectStoragePort } from '@afa/domain';
import { ObjectNotFoundError, ObjectStorageUnavailableError } from '@afa/domain';

const LIST_PAGE_SIZE = 100;

interface StorageErrorLike {
  message?: string;
  statusCode?: string;
}

function isNotFoundError(error: StorageErrorLike | null | undefined): boolean {
  if (!error) {
    return false;
  }
  const message = error.message?.toLowerCase() ?? '';
  return (
    error.statusCode === '404' || message.includes('not found') || message.includes('not_found')
  );
}

/**
 * TASK-AI-006 (Object Storage groundwork) — production `ObjectStoragePort`
 * adapter backed by Supabase Storage (S3-compatible), the provider decided
 * per the pre-implementation audit (`FakeObjectStorage` is process-local
 * in-memory and cannot support the Telegram-bot -> Worker cross-process
 * hand-off the OCR/STT pipelines need). The `SupabaseClient` is constructed
 * once by the composition root (`object-storage.module.ts`'s
 * `buildObjectStorage` factory) and injected here — this class never reads
 * env vars or credentials directly, which keeps it trivially unit-testable
 * against a hand-built fake client and matches `AnthropicLlmProvider`'s own
 * "adapter receives an already-configured client" convention.
 *
 * Error mapping is deterministic and never leaks the raw provider error to
 * a caller: the raw Supabase error is logged server-side only; callers
 * only ever see `ObjectNotFoundError` (missing object, matching this port's
 * existing semantics) or `ObjectStorageUnavailableError` (every other
 * failure — auth, network, misconfiguration), exactly the two subclasses
 * `RoutePhotoMessageUseCase`/`RouteVoiceMessageUseCase`/
 * `PrismaAccountPurgeRepository` already catch via `instanceof ObjectStorageError`.
 */
export class SupabaseObjectStorage implements ObjectStoragePort {
  private readonly logger = new Logger(SupabaseObjectStorage.name);

  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  private get storage() {
    return this.client.storage.from(this.bucket);
  }

  async putObject(uri: string, data: Buffer, contentType: string): Promise<void> {
    // upsert: true — matches FakeObjectStorage's Map#set semantics (a
    // second putObject at the same key silently replaces it, never errors),
    // required for RoutePhotoMessageUseCase/RouteVoiceMessageUseCase's own
    // deterministic-jobId redelivery idempotency to hold against the real
    // adapter too.
    const { error } = await this.storage.upload(uri, data, { contentType, upsert: true });
    if (error) {
      this.logger.error(`Supabase Storage upload failed for "${uri}": ${error.message}`);
      throw new ObjectStorageUnavailableError();
    }
  }

  async getObject(uri: string): Promise<Buffer> {
    const { data, error } = await this.storage.download(uri);
    if (error || !data) {
      if (isNotFoundError(error as StorageErrorLike | null)) {
        throw new ObjectNotFoundError(uri);
      }
      this.logger.error(
        `Supabase Storage download failed for "${uri}": ${error?.message ?? 'no data returned'}`,
      );
      throw new ObjectStorageUnavailableError();
    }
    return Buffer.from(await data.arrayBuffer());
  }

  /** Idempotent — Supabase Storage's remove() does not error on an absent key, matching this port's documented contract. */
  async deleteObject(uri: string): Promise<void> {
    const { error } = await this.storage.remove([uri]);
    if (error) {
      this.logger.error(`Supabase Storage delete failed for "${uri}": ${error.message}`);
      throw new ObjectStorageUnavailableError();
    }
  }

  /**
   * Paginated: lists and deletes one page (`LIST_PAGE_SIZE`) at a time,
   * always re-listing from the top rather than advancing an offset —
   * deleting the current page shifts the remaining objects down, so
   * advancing an offset after a delete would silently skip objects. Never
   * assumes a user's objects fit in a single request. `entry.id === null`
   * (Supabase's pseudo-directory marker) is filtered out defensively, even
   * though this codebase's flat `voice/{userId}/...`/`photo/{userId}/...`
   * key convention never nests real subfolders under a user prefix.
   */
  async deleteObjectsByPrefix(prefix: string): Promise<void> {
    const folder = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;

    for (;;) {
      const { data, error } = await this.storage.list(folder, { limit: LIST_PAGE_SIZE, offset: 0 });
      if (error) {
        this.logger.error(`Supabase Storage list failed for prefix "${prefix}": ${error.message}`);
        throw new ObjectStorageUnavailableError();
      }

      const files = (data ?? []).filter((entry) => entry.id !== null);
      if (files.length === 0) {
        return;
      }

      const paths = files.map((file) => `${folder}/${file.name}`);
      const { error: removeError } = await this.storage.remove(paths);
      if (removeError) {
        this.logger.error(
          `Supabase Storage bulk delete failed for prefix "${prefix}": ${removeError.message}`,
        );
        throw new ObjectStorageUnavailableError();
      }

      if (files.length < LIST_PAGE_SIZE) {
        return;
      }
    }
  }
}
