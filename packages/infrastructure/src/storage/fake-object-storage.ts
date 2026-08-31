import type { Buffer } from 'node:buffer';
import { ObjectNotFoundError } from '@afa/domain';
import type { ObjectStoragePort } from '@afa/domain';

/**
 * A deterministic, in-memory `ObjectStoragePort` test double — never wired
 * into any production DI module. A real implementation (e.g. an S3-
 * compatible client) is a future composition-root concern; no vendor SDK
 * is introduced by this task (REAL_PROVIDER_STATUS = ENVIRONMENT-BLOCKED,
 * same as the STT provider itself — see this task's final report).
 */
export class FakeObjectStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, Buffer>();

  put(uri: string, data: Buffer): void {
    this.objects.set(uri, data);
  }

  async getObject(uri: string): Promise<Buffer> {
    const data = this.objects.get(uri);
    if (!data) {
      throw new ObjectNotFoundError(uri);
    }
    return data;
  }

  async putObject(uri: string, data: Buffer): Promise<void> {
    this.objects.set(uri, data);
  }

  /** Idempotent — deleting an absent key is a no-op, matching this port's own documented contract. */
  async deleteObject(uri: string): Promise<void> {
    this.objects.delete(uri);
  }

  /** Idempotent — an absent/empty prefix deletes nothing, matching `deleteObject`'s own convention. */
  async deleteObjectsByPrefix(prefix: string): Promise<void> {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
      }
    }
  }
}
