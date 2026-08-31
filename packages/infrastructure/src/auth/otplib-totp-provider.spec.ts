import { describe, expect, it } from 'vitest';
import { generate } from 'otplib';

import { OtplibTotpProvider } from './otplib-totp-provider';

describe('OtplibTotpProvider', () => {
  const provider = new OtplibTotpProvider();

  it('generates a secret and a matching otpauth enrollment URL', () => {
    const { secret, otpauthUrl } = provider.generateSecret('admin@example.com');
    expect(secret.length).toBeGreaterThan(0);
    expect(otpauthUrl).toContain('otpauth://totp/');
    expect(otpauthUrl).toContain(encodeURIComponent('admin@example.com'));
  });

  it('verifies the currently valid code for a generated secret', async () => {
    const { secret } = provider.generateSecret('admin@example.com');
    const code = await generate({ secret });
    await expect(provider.verify(secret, code)).resolves.toBe(true);
  });

  it('rejects an incorrect code', async () => {
    const { secret } = provider.generateSecret('admin@example.com');
    const correctCode = await generate({ secret });
    const wrongCode = correctCode === '000000' ? '111111' : '000000';
    await expect(provider.verify(secret, wrongCode)).resolves.toBe(false);
  });

  it('fails closed against a malformed secret', async () => {
    await expect(provider.verify('not-a-real-base32-secret-!!!', '123456')).resolves.toBe(false);
  });
});
