import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { ObjectNotFoundError } from '@afa/domain';

import { FakeObjectStorage } from './fake-object-storage';

describe('FakeObjectStorage', () => {
  it('returns a previously-put object', async () => {
    const storage = new FakeObjectStorage();
    const data = Buffer.from('fake-audio-bytes');
    storage.put('s3://bucket/voice/1.ogg', data);

    const result = await storage.getObject('s3://bucket/voice/1.ogg');

    expect(result).toEqual(data);
  });

  it('throws ObjectNotFoundError for a URI that was never uploaded (missing Telegram file / expired object)', async () => {
    const storage = new FakeObjectStorage();

    await expect(storage.getObject('s3://bucket/voice/missing.ogg')).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it('TASK-AUTH-006 — deleteObject removes a previously-put object, so a subsequent getObject throws ObjectNotFoundError', async () => {
    const storage = new FakeObjectStorage();
    storage.put('s3://bucket/voice/1.ogg', Buffer.from('fake-audio-bytes'));

    await storage.deleteObject('s3://bucket/voice/1.ogg');

    await expect(storage.getObject('s3://bucket/voice/1.ogg')).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it('TASK-AUTH-006 — deleteObject on a URI that was never uploaded is a safe no-op, never throws (idempotent, purge-retry-safe)', async () => {
    const storage = new FakeObjectStorage();

    await expect(
      storage.deleteObject('s3://bucket/voice/never-existed.ogg'),
    ).resolves.toBeUndefined();
  });

  it('TASK-AUTH-006 — deleteObjectsByPrefix removes every object whose key starts with the prefix, leaving others untouched', async () => {
    const storage = new FakeObjectStorage();
    storage.put('voice/user-1/a.ogg', Buffer.from('a'));
    storage.put('voice/user-1/b.ogg', Buffer.from('b'));
    storage.put('voice/user-2/c.ogg', Buffer.from('c'));

    await storage.deleteObjectsByPrefix('voice/user-1/');

    await expect(storage.getObject('voice/user-1/a.ogg')).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
    await expect(storage.getObject('voice/user-1/b.ogg')).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
    await expect(storage.getObject('voice/user-2/c.ogg')).resolves.toEqual(Buffer.from('c'));
  });

  it('TASK-AUTH-006 — deleteObjectsByPrefix on a prefix with no matching objects is a safe no-op, never throws', async () => {
    const storage = new FakeObjectStorage();
    storage.put('photo/user-9/x.jpg', Buffer.from('x'));

    await expect(
      storage.deleteObjectsByPrefix('voice/user-does-not-exist/'),
    ).resolves.toBeUndefined();
    await expect(storage.getObject('photo/user-9/x.jpg')).resolves.toEqual(Buffer.from('x'));
  });

  it('TASK-AUTH-006 — deleteObjectsByPrefix does not match a different user id that merely shares a prefix substring', async () => {
    const storage = new FakeObjectStorage();
    storage.put('voice/user-1/a.ogg', Buffer.from('a'));
    storage.put('voice/user-10/b.ogg', Buffer.from('b'));

    await storage.deleteObjectsByPrefix('voice/user-1/');

    await expect(storage.getObject('voice/user-1/a.ogg')).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
    await expect(storage.getObject('voice/user-10/b.ogg')).resolves.toEqual(Buffer.from('b'));
  });
});
