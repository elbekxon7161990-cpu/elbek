import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';
import type { SecretStorePort } from '@afa/domain';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;
const REFERENCE_PREFIX = 'v1';

/**
 * TASK-AUTH-002 — `SecretStorePort` adapter (Decision 3). Audited before
 * writing this: no Vault/AWS-Secrets-Manager/GCP-Secret-Manager/equivalent
 * exists anywhere in this repository's source or deployment configuration
 * (docker-compose.yml, .env.example files, Chapter 17 §17.17.2) — the PRD
 * requires "a dedicated secrets manager" (FR-SCR-M-001) but never commits
 * this deployment to one, so binding a specific vendor SDK here would be
 * guessing, which this task's own instructions explicitly forbid.
 *
 * What this adapter actually does instead: AES-256-GCM envelope encryption
 * with a single symmetric master key from `MFA_SECRET_ENCRYPTION_KEY`
 * (itself still an operator-managed secret, no better housed than any other
 * credential this deployment already keeps in `.env` — e.g.
 * `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`). This is deliberately NOT presented
 * as satisfying FR-SCR-M-001's letter (a real secrets manager is a
 * dedicated external system, not an application-level encryption key) — it
 * is presented honestly as the smallest interim step that keeps the actual
 * TOTP seed itself out of PostgreSQL (schema.prisma's own "never the raw
 * TOTP seed in this table" commitment), never written or logged in
 * plaintext anywhere, while every call site depends only on `SecretStorePort`
 * — swapping in a real secrets-manager-backed adapter later requires
 * changing this one file, no caller.
 *
 * See `SecretStoreModule` for the (loud, startup-logged) production binding
 * of this adapter, and `FakeSecretStore` for the separate, never-wired-to-
 * production, in-memory test double.
 */
@Injectable()
export class LocalEnvelopeSecretStore implements SecretStorePort {
  private readonly key: Buffer;

  constructor(config: ConfigService<EnvironmentVariables>) {
    const encoded = config.get('MFA_SECRET_ENCRYPTION_KEY', { infer: true });
    if (!encoded) {
      throw new Error(
        'MFA_SECRET_ENCRYPTION_KEY is required to store/reveal admin MFA secrets and was not set.',
      );
    }
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `MFA_SECRET_ENCRYPTION_KEY must decode (base64) to exactly ${KEY_LENGTH_BYTES} bytes, got ${key.length}.`,
      );
    }
    this.key = key;
  }

  async protect(secretValue: string): Promise<string> {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(secretValue, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      REFERENCE_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  async reveal(reference: string): Promise<string> {
    const parts = reference.split('.');
    if (parts.length !== 4 || parts[0] !== REFERENCE_PREFIX) {
      throw new Error('Malformed secret-store reference.');
    }
    const [, ivB64, authTagB64, ciphertextB64] = parts;
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
