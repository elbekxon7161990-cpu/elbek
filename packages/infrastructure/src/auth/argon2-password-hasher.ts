import { Injectable } from '@nestjs/common';
import type { PasswordHasherPort } from '@afa/domain';
import * as argon2 from 'argon2';

/**
 * TASK-AUTH-002 — PRD does not prescribe an algorithm; this task's explicit
 * instruction is Argon2id via a maintained library, never a hand-rolled
 * implementation. `argon2` (node-argon2) is the standard maintained Node
 * binding, defaults to the Argon2id variant, OWASP-recommended parameters.
 */
@Injectable()
export class Argon2PasswordHasher implements PasswordHasherPort {
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, { type: argon2.argon2id });
  }

  async verify(plaintext: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      // Malformed/foreign hash string — never a real match; fail closed
      // rather than let a parse error propagate as an unhandled rejection
      // out of a security-critical comparison.
      return false;
    }
  }
}
