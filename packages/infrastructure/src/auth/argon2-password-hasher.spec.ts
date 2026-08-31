import { describe, expect, it } from 'vitest';

import { Argon2PasswordHasher } from './argon2-password-hasher';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('hashes a password and verifies the correct plaintext against it', async () => {
    const hash = await hasher.hash('a-correct-horse-battery-staple');
    expect(hash).not.toBe('a-correct-horse-battery-staple');
    await expect(hasher.verify('a-correct-horse-battery-staple', hash)).resolves.toBe(true);
  });

  it('rejects the wrong plaintext', async () => {
    const hash = await hasher.hash('a-correct-horse-battery-staple');
    await expect(hasher.verify('wrong-password', hash)).resolves.toBe(false);
  });

  it('produces a different hash for the same plaintext on repeated calls (random salt)', async () => {
    const [hashA, hashB] = await Promise.all([
      hasher.hash('same-plaintext'),
      hasher.hash('same-plaintext'),
    ]);
    expect(hashA).not.toBe(hashB);
  });

  it('fails closed (returns false, never throws) against a malformed hash string', async () => {
    await expect(hasher.verify('anything', 'not-a-real-argon2-hash')).resolves.toBe(false);
  });
});
