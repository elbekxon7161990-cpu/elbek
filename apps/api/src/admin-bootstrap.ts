import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  AdminAlreadyExistsError,
  AdminBootstrapModule,
  BootstrapAdminUseCase,
  BreachedAdminPasswordError,
  WeakAdminPasswordError,
} from '@afa/application';
import { AdminAuthProvidersModule, AdminRepositoryModule, PrismaModule } from '@afa/infrastructure';
import { AppConfigModule } from '@afa/shared';

/**
 * TASK-AUTH-002 Decision 4 — controlled, operator-run CLI provisioning.
 * NEVER a public HTTP endpoint (no route in `apps/api` calls
 * `BootstrapAdminUseCase` — only this script does), so there is no
 * self-service admin registration surface anywhere in this system.
 *
 * Run: `pnpm --filter @afa/api run admin:bootstrap`
 * Reads `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` from the
 * environment — deliberately NOT from CLI arguments, since argv is visible
 * in shell history and process listings (`ps`) on most systems, an
 * unnecessary exposure for a credential this sensitive. Never hardcoded
 * anywhere in this file.
 *
 * The generated TOTP enrollment URI is written directly to this process's
 * own stdout — a one-time, operator-facing value the operator is expected
 * to scan into an authenticator app immediately and then discard — never
 * routed through the application's own structured/persisted logger
 * (`nestjs-pino`), so it never lands in normal application logs.
 */
@Module({
  imports: [
    AppConfigModule.forRoot(),
    PrismaModule,
    AdminRepositoryModule,
    AdminAuthProvidersModule,
    AdminBootstrapModule,
  ],
})
class AdminBootstrapCliModule {}

async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) {
    process.stderr.write(
      'Usage: BOOTSTRAP_ADMIN_EMAIL=<email> BOOTSTRAP_ADMIN_PASSWORD=<password> pnpm --filter @afa/api run admin:bootstrap\n' +
        '(Password must be >= 12 characters and not appear in a known breach corpus.)\n',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AdminBootstrapCliModule, {
    logger: false,
  });

  try {
    const useCase = app.get(BootstrapAdminUseCase);
    const { admin, otpauthUrl } = await useCase.execute({ email, password });

    process.stdout.write('\nAdmin bootstrapped successfully.\n');
    process.stdout.write(`  id:    ${admin.id}\n`);
    process.stdout.write(`  email: ${admin.email}\n`);
    process.stdout.write(`  role:  ${admin.role}\n\n`);
    process.stdout.write('Scan this into an authenticator app now — it is shown only once:\n');
    process.stdout.write(`  ${otpauthUrl}\n\n`);
  } catch (error) {
    if (error instanceof AdminAlreadyExistsError) {
      process.stderr.write(`Bootstrap aborted: ${error.message}\n`);
      process.exitCode = 1;
    } else if (
      error instanceof WeakAdminPasswordError ||
      error instanceof BreachedAdminPasswordError
    ) {
      process.stderr.write(`Bootstrap aborted: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  } finally {
    await app.close();
  }
}

void main();
