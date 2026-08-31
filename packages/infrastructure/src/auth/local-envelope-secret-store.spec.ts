import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';

import { LocalEnvelopeSecretStore } from './local-envelope-secret-store';

function storeWithKey(keyBase64: string): LocalEnvelopeSecretStore {
  const config = new ConfigService<EnvironmentVariables>({
    MFA_SECRET_ENCRYPTION_KEY: keyBase64,
  } as Partial<EnvironmentVariables>);
  return new LocalEnvelopeSecretStore(config);
}

describe('LocalEnvelopeSecretStore', () => {
  const key = randomBytes(32).toString('base64');

  it('protects a secret and reveals the same value back', async () => {
    const store = storeWithKey(key);
    const reference = await store.protect('JBSWY3DPEHPK3PXP');
    expect(reference).not.toContain('JBSWY3DPEHPK3PXP');
    await expect(store.reveal(reference)).resolves.toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces a different reference for the same secret on repeated calls (random IV)', async () => {
    const store = storeWithKey(key);
    const [refA, refB] = await Promise.all([
      store.protect('same-secret'),
      store.protect('same-secret'),
    ]);
    expect(refA).not.toBe(refB);
  });

  it('fails to reveal with the wrong key', async () => {
    const store = storeWithKey(key);
    const reference = await store.protect('JBSWY3DPEHPK3PXP');
    const otherStore = storeWithKey(randomBytes(32).toString('base64'));
    await expect(otherStore.reveal(reference)).rejects.toThrow();
  });

  it('throws at construction when the key is missing', () => {
    const config = new ConfigService<EnvironmentVariables>({} as Partial<EnvironmentVariables>);
    expect(() => new LocalEnvelopeSecretStore(config)).toThrow(/required/);
  });

  it('throws at construction when the key is not 32 bytes', () => {
    const config = new ConfigService<EnvironmentVariables>({
      MFA_SECRET_ENCRYPTION_KEY: Buffer.from('too-short').toString('base64'),
    } as Partial<EnvironmentVariables>);
    expect(() => new LocalEnvelopeSecretStore(config)).toThrow(/32 bytes/);
  });

  it('rejects a malformed reference string', async () => {
    const store = storeWithKey(key);
    await expect(store.reveal('not-a-real-reference')).rejects.toThrow(/Malformed/);
  });
});
