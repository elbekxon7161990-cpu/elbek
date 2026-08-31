import { Injectable } from '@nestjs/common';
import type { BreachedPasswordCheckerPort } from '@afa/domain';

/**
 * TASK-AUTH-002 — §7.1.8 requires a breached-password blocklist check but
 * the PRD never names a mechanism/provider, and none is configured anywhere
 * in this repository (audited). Per this task's explicit instruction, this
 * adapter does NOT silently invent an external service (e.g. calling
 * a third-party breach-corpus API without an explicit decision to do so).
 *
 * Instead: this adapter always resolves `false` (never blocks a password on
 * breach grounds) and `BreachedPasswordCheckerModule` logs loudly on every
 * startup that this check is NOT actually enforced — the same
 * "TEMPORARY... must be REPLACED, never extended" disclosure pattern this
 * codebase already established for `EnvironmentBlockedProvidersModule`. This
 * is a disclosed, visible gap, not a silently weakened requirement — see
 * this task's final report for the explicit provider decision still needed.
 */
@Injectable()
export class NoOpBreachedPasswordChecker implements BreachedPasswordCheckerPort {
  async isBreached(): Promise<boolean> {
    return false;
  }
}
