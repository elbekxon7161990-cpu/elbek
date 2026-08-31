export const SECRET_STORE = Symbol('SECRET_STORE');

/**
 * TASK-AUTH-002 — abstracts "protect a secret value, get back an opaque
 * reference" / "resolve a reference back to the secret value" so
 * `Admin.mfaSecretRef` can hold only a reference (schema.prisma's own
 * comment: "never the raw TOTP seed in this table"), never the raw secret,
 * regardless of which concrete backend implements this port.
 *
 * FR-SCR-M-001 calls for a dedicated secrets manager; this repository has
 * none configured (audited: no Vault/AWS-SM/GCP-SM/equivalent anywhere in
 * source or deployment config). This port exists precisely so a real
 * secrets-manager-backed adapter can be substituted later with zero changes
 * to any caller — see packages/infrastructure's own adapter for exactly
 * which interim implementation is bound today and why.
 */
export interface SecretStorePort {
  protect(secretValue: string): Promise<string>;
  reveal(reference: string): Promise<string>;
}
