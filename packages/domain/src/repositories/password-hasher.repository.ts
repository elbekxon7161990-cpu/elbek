export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

/**
 * TASK-AUTH-002 — the PRD does not prescribe a specific hashing algorithm
 * (audited: no `bcrypt`/`argon2`/`scrypt` mention anywhere in the PRD). Per
 * this task's explicit instruction, the concrete implementation is Argon2id
 * via a maintained library (packages/infrastructure) — this port exists so
 * no call site ever depends on that choice directly, and manual/home-grown
 * hashing is structurally impossible (every caller goes through here).
 */
export interface PasswordHasherPort {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, hash: string): Promise<boolean>;
}
