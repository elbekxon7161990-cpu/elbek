import { randomUUID } from 'node:crypto';
import type { SecretStorePort } from '@afa/domain';

/**
 * A deterministic, in-memory `SecretStorePort` test double — never wired
 * into any production DI module (unlike `LocalEnvelopeSecretStore`, which
 * IS wired into production pending a real secrets-manager adapter — see
 * that adapter's own doc comment for why an in-memory fake is unsafe for
 * that role: losing the map on restart would permanently lock out every
 * admin's MFA, a materially different failure mode than the inert
 * "not implemented yet" degradation `FakeObjectStorage`/`FakeSttProvider`
 * safely provide elsewhere in this codebase). This fake exists purely so
 * unit tests do not need a real encryption key configured.
 */
export class FakeSecretStore implements SecretStorePort {
  private readonly secrets = new Map<string, string>();

  async protect(secretValue: string): Promise<string> {
    const reference = randomUUID();
    this.secrets.set(reference, secretValue);
    return reference;
  }

  async reveal(reference: string): Promise<string> {
    const value = this.secrets.get(reference);
    if (value === undefined) {
      throw new Error(`FakeSecretStore: no secret stored for reference "${reference}".`);
    }
    return value;
  }
}
