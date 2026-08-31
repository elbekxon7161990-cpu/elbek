import { Injectable } from '@nestjs/common';
import type { GeneratedTotpSecret, TotpProviderPort } from '@afa/domain';
import { generateSecret, generateURI, verify } from 'otplib';

const ISSUER = 'AI Personal Finance Assistant Admin';

/**
 * A time step's worth of tolerance in either direction (~30s), matching
 * RFC 6238 §6's own "Resynchronization" guidance and every mainstream
 * authenticator app's expected leeway for ordinary clock drift/network
 * delay — not a novel parameter invented for this task. otplib v13's own
 * default (`epochTolerance: 0`, exact-step-only) is stricter than RFC 6238
 * itself requires and would make login fail on the smallest real clock
 * skew; this explicit override is documented here rather than silently
 * relied upon as "the library default".
 */
const EPOCH_TOLERANCE_STEPS = 1;

/**
 * TASK-AUTH-002 (FR-AUTH-008) — TOTP (RFC 6238) baseline via otplib's
 * functional API. digits (6) / period (30s) / algorithm (SHA1) are all left
 * at otplib's own defaults, which are themselves RFC 6238's defaults — the
 * PRD cites the RFC as the baseline without further parameterizing it, so
 * this task does not invent parameters beyond the RFC's own defaults except
 * the explicitly-documented `epochTolerance` above.
 */
@Injectable()
export class OtplibTotpProvider implements TotpProviderPort {
  generateSecret(accountLabel: string): GeneratedTotpSecret {
    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: ISSUER, label: accountLabel, secret });
    return { secret, otpauthUrl };
  }

  async verify(secret: string, code: string): Promise<boolean> {
    try {
      const result = await verify({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_STEPS });
      return result.valid;
    } catch {
      // Malformed code/secret — never a real match; fail closed.
      return false;
    }
  }
}
