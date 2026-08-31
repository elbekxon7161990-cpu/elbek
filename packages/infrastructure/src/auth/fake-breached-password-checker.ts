import type { BreachedPasswordCheckerPort } from '@afa/domain';

/** Test-only — configurable result, never wired into any production DI module. */
export class FakeBreachedPasswordChecker implements BreachedPasswordCheckerPort {
  constructor(private readonly result: boolean) {}

  async isBreached(): Promise<boolean> {
    return this.result;
  }
}
