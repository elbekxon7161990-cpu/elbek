import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { generate } from 'otplib';
import {
  AppConfigModule,
  AppLoggerModule,
  AllExceptionsFilter,
  createValidationPipe,
} from '@afa/shared';
import { AdminBootstrapModule, BootstrapAdminUseCase } from '@afa/application';
import {
  AdminAuthProvidersModule,
  AdminRepositoryModule,
  PrismaModule,
  PrismaService,
  RedisModule,
} from '@afa/infrastructure';
import {
  ADMIN_LOCKOUT_BACKOFF_SCHEDULE_MS,
  ADMIN_LOCKOUT_FAILURE_THRESHOLD,
  ADMIN_SESSION_IDLE_TIMEOUT_MS,
} from '@afa/domain';

import { AdminAuthHttpModule } from './admin-auth-http.module';

/**
 * Same module list as `apps/api/src/app.module.ts`, minus `HealthModule`.
 * `HealthModule`'s `TerminusModule` has a pre-existing (unrelated to this
 * task) incompatibility with `@nestjs/testing`'s `Test.createTestingModule`
 * + `createNestApplication()` + `.init()` combination — its internal
 * `HealthCheckService` fails to resolve through `TestingInjector`
 * specifically, even though the identical `AppModule` boots `HealthController`
 * cleanly via the real `NestFactory.create()` path `main.ts` itself uses.
 * `HealthModule` is out of this task's scope (TASK-AUTH-002 never touches
 * it), so this suite tests the real `AdminAuthHttpModule` wiring through a
 * module list that is otherwise identical to production, without tripping
 * that unrelated, pre-existing Terminus/testing-module interaction.
 */
@Module({
  imports: [
    AppConfigModule.forRoot(),
    AppLoggerModule.forRoot('afa-api-e2e-test'),
    PrismaModule,
    RedisModule,
    AdminAuthHttpModule,
  ],
})
class AdminAuthE2eAppModule {}

/**
 * TASK-AUTH-002 — the "deliberate lockout-threshold test" this task's
 * Definition of Done requires, plus the full set of protected-route proofs
 * this task's implementation order asked for. Real Postgres + real Redis,
 * the full real HTTP surface (supertest against a genuinely running Nest
 * application, the same global pipes/filters `main.ts` itself applies) —
 * no mocks, no fakes, matching this codebase's own `*.e2e.spec.ts`/
 * `*.integration.spec.ts` precedent (e.g.
 * `apps/worker/src/e2e/generate-report.integration.spec.ts`).
 *
 * Two separate NestJS contexts, mirroring the real production topology
 * exactly: `bootstrapContext` (a headless application context — no HTTP,
 * same shape as `admin-bootstrap.ts`'s own CLI, proven by
 * `admin-bootstrap-di.integration.spec.ts`, whose exact module list this
 * mirrors) seeds test admins through the real `BootstrapAdminUseCase`, and
 * `app` (an HTTP application built from `AppModule` alone, same as
 * `main.ts`) is what supertest exercises. In production these are two
 * separate OS processes that never share a DI container — kept separate
 * here too, rather than combined into one `Test.createTestingModule`.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MFA_SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

function extractTotpSecret(otpauthUrl: string): string {
  const secret = new URL(otpauthUrl).searchParams.get('secret');
  if (!secret) {
    throw new Error(`otpauth URL carried no secret param: ${otpauthUrl}`);
  }
  return secret;
}

function uniqueEmail(label: string): string {
  return `auth002-e2e-${label}-${randomBytes(4).toString('hex')}@example.invalid`;
}

describe('Admin Auth — protected-route end-to-end (real Postgres + real Redis)', () => {
  let app: INestApplication;
  let bootstrapContext: INestApplicationContext;
  let prisma: PrismaService;
  const seededEmails: string[] = [];

  beforeAll(async () => {
    const bootstrapModuleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        AdminRepositoryModule,
        AdminAuthProvidersModule,
        AdminBootstrapModule,
      ],
    }).compile();
    bootstrapContext = await bootstrapModuleRef.init();

    const appModuleRef = await Test.createTestingModule({
      imports: [AdminAuthE2eAppModule],
    }).compile();
    app = appModuleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    // Guarded — if `beforeAll` itself failed (e.g. no reachable Postgres in
    // this environment), these were never assigned; without the guard,
    // `afterAll` throwing on top of an already-failed `beforeAll` would
    // misreport this suite as "failed" rather than the same clean
    // "beforeAll threw, tests skipped" outcome every other real-Postgres
    // suite in this codebase produces.
    if (prisma && seededEmails.length > 0) {
      // Child rows first — `admin_sessions.admin_id` has no ON DELETE
      // CASCADE (schema.prisma's own deliberate no-hard-cascade posture,
      // §13.14), so deleting the parent `admin` row first violates its FK.
      await prisma.adminSession.deleteMany({ where: { admin: { email: { in: seededEmails } } } });
      await prisma.admin.deleteMany({ where: { email: { in: seededEmails } } });
    }
    if (bootstrapContext) {
      await bootstrapContext.close();
    }
    if (app) {
      await app.close();
    }
  }, 30_000);

  async function seedAdmin(
    label: string,
    password: string,
  ): Promise<{ email: string; secret: string }> {
    const email = uniqueEmail(label);
    seededEmails.push(email);
    const bootstrap = bootstrapContext.get(BootstrapAdminUseCase);
    const { otpauthUrl } = await bootstrap.execute({ email, password });
    return { email, secret: extractTotpSecret(otpauthUrl) };
  }

  async function fullLogin(
    email: string,
    password: string,
    secret: string,
  ): Promise<{ sessionToken: string; expiresAt: string }> {
    const loginRes = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password })
      .expect(200);
    const code = await generate({ secret });
    const verifyRes = await request(app.getHttpServer())
      .post('/admin/auth/mfa/verify')
      .send({ challengeToken: loginRes.body.challengeToken, code })
      .expect(200);
    return verifyRes.body;
  }

  it('rejects an unauthenticated request to a protected route', async () => {
    await request(app.getHttpServer()).get('/admin/auth/me').expect(401);
  });

  it('password step alone never grants access to a protected route (the challenge token is not a session token)', async () => {
    const { email } = await seedAdmin('password-only', 'a-long-enough-password-1');
    const loginRes = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: 'a-long-enough-password-1' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.challengeToken}`)
      .expect(401);
  });

  it('the MFA step alone (a fabricated challenge, never a real password step) never grants access', async () => {
    await request(app.getHttpServer())
      .post('/admin/auth/mfa/verify')
      .send({ challengeToken: 'not-a-real-challenge-token', code: '123456' })
      .expect(401);
  });

  it('password + valid MFA together reach the protected route; invalid password and invalid MFA are both rejected generically', async () => {
    const { email, secret } = await seedAdmin('full-flow', 'a-long-enough-password-2');

    // Invalid password.
    const badPasswordRes = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: 'totally-wrong' })
      .expect(401);

    // Unknown email — same generic shape as invalid password (no existence leak).
    const unknownEmailRes = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: 'nobody-at-all@example.invalid', password: 'totally-wrong' })
      .expect(401);
    expect(unknownEmailRes.body.message).toEqual(badPasswordRes.body.message);

    // Correct password → challenge, then invalid MFA code.
    const loginRes = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: 'a-long-enough-password-2' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/admin/auth/mfa/verify')
      .send({ challengeToken: loginRes.body.challengeToken, code: '000000' })
      .expect(401);

    // Correct password + correct MFA → real session → protected route reachable.
    const session = await fullLogin(email, 'a-long-enough-password-2', secret);
    const meRes = await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(200);
    expect(meRes.body.email).toBe(email);
  }, 30_000);

  it('invalid password increments the failure counter; invalid MFA increments the SAME counter', async () => {
    const { email, secret } = await seedAdmin('increment', 'a-long-enough-password-3');

    await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: 'wrong-1' })
      .expect(401);
    let admin = await prisma.admin.findUniqueOrThrow({ where: { email } });
    expect(admin.failedLoginAttempts).toBe(1);

    const loginRes = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: 'a-long-enough-password-3' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/admin/auth/mfa/verify')
      .send({ challengeToken: loginRes.body.challengeToken, code: '000000' })
      .expect(401);
    admin = await prisma.admin.findUniqueOrThrow({ where: { email } });
    expect(admin.failedLoginAttempts).toBe(2);

    // A subsequent fully-successful login resets the shared counter to 0.
    await fullLogin(email, 'a-long-enough-password-3', secret);
    admin = await prisma.admin.findUniqueOrThrow({ where: { email } });
    expect(admin.failedLoginAttempts).toBe(0);
    expect(admin.failedLoginWindowStartedAt).toBeNull();
    expect(admin.lockoutCycleCount).toBe(0);
  }, 30_000);

  it(`locks the account on the ${ADMIN_LOCKOUT_FAILURE_THRESHOLD}th consecutive failure within the window (deliberate lockout-threshold test) — a correct password during lockout is STILL rejected generically`, async () => {
    const { email } = await seedAdmin('lockout-threshold', 'a-long-enough-password-4');

    for (let i = 0; i < ADMIN_LOCKOUT_FAILURE_THRESHOLD; i += 1) {
      await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ email, password: 'wrong-forever' })
        .expect(401);
    }

    const admin = await prisma.admin.findUniqueOrThrow({ where: { email } });
    expect(admin.lockoutCycleCount).toBe(1);
    expect(admin.lockedUntil).not.toBeNull();
    expect(admin.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(admin.lockedUntil!.getTime()).toBeLessThanOrEqual(
      Date.now() + ADMIN_LOCKOUT_BACKOFF_SCHEDULE_MS[0] + 5_000,
    );
    // Lock transition resets the raw counters — state is fully described by lockedUntil/lockoutCycleCount now.
    expect(admin.failedLoginAttempts).toBe(0);

    // Even the CORRECT password is rejected — generically — while locked.
    const attemptDuringLockout = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: 'a-long-enough-password-4' })
      .expect(401);
    expect(attemptDuringLockout.body).toBeDefined();

    // And the lockout state itself is untouched by that attempt (no increment while locked).
    const afterAttempt = await prisma.admin.findUniqueOrThrow({ where: { email } });
    expect(afterAttempt.lockoutCycleCount).toBe(1);
    expect(afterAttempt.lockedUntil!.getTime()).toBe(admin.lockedUntil!.getTime());
  }, 30_000);

  it('applies the exponential backoff schedule across repeated lockout cycles', async () => {
    const { email } = await seedAdmin('backoff-schedule', 'a-long-enough-password-5');

    for (let i = 0; i < ADMIN_LOCKOUT_FAILURE_THRESHOLD; i += 1) {
      await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ email, password: 'wrong-forever' })
        .expect(401);
    }
    let admin = await prisma.admin.findUniqueOrThrow({ where: { email } });
    expect(admin.lockoutCycleCount).toBe(1);

    // Force the first lockout to have already expired (simulating real
    // elapsed time) without touching `lockoutCycleCount` — this is exactly
    // the state a real clock would produce after ~1 minute, exercised here
    // without the test actually waiting on a wall-clock minute.
    await prisma.admin.update({
      where: { email },
      data: { lockedUntil: new Date(Date.now() - 1_000) },
    });

    for (let i = 0; i < ADMIN_LOCKOUT_FAILURE_THRESHOLD; i += 1) {
      await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ email, password: 'wrong-forever-again' })
        .expect(401);
    }
    admin = await prisma.admin.findUniqueOrThrow({ where: { email } });
    expect(admin.lockoutCycleCount).toBe(2);
    const secondLockoutDurationMs = admin.lockedUntil!.getTime() - Date.now();
    expect(secondLockoutDurationMs).toBeGreaterThan(ADMIN_LOCKOUT_BACKOFF_SCHEDULE_MS[0]);
    expect(secondLockoutDurationMs).toBeLessThanOrEqual(
      ADMIN_LOCKOUT_BACKOFF_SCHEDULE_MS[1] + 5_000,
    );
  }, 30_000);

  it('rejects a session past its absolute (24h) expiry', async () => {
    const { email, secret } = await seedAdmin('absolute-expiry', 'a-long-enough-password-6');
    const session = await fullLogin(email, 'a-long-enough-password-6', secret);

    await prisma.adminSession.updateMany({
      where: { admin: { email } },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(401);
  }, 30_000);

  it('rejects a session past its idle (12h) timeout even though it has not reached its absolute expiry', async () => {
    const { email, secret } = await seedAdmin('idle-timeout', 'a-long-enough-password-7');
    const session = await fullLogin(email, 'a-long-enough-password-7', secret);

    await prisma.adminSession.updateMany({
      where: { admin: { email } },
      data: { lastActiveAt: new Date(Date.now() - ADMIN_SESSION_IDLE_TIMEOUT_MS - 60_000) },
    });

    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(401);
  }, 30_000);

  // TASK-AUTH-004 — Session Management Architecture (FR-SEC-010/011/012).

  it("CROSS-IDENTITY ISOLATION — two admins with the SAME role each get their own session, and one admin's token never authenticates as the other", async () => {
    const adminA = await seedAdmin('cross-identity-a', 'a-long-enough-password-8a');
    const adminB = await seedAdmin('cross-identity-b', 'a-long-enough-password-8b');
    const sessionA = await fullLogin(adminA.email, 'a-long-enough-password-8a', adminA.secret);
    const sessionB = await fullLogin(adminB.email, 'a-long-enough-password-8b', adminB.secret);

    const meAsA = await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${sessionA.sessionToken}`)
      .expect(200);
    expect(meAsA.body.email).toBe(adminA.email);
    expect(meAsA.body.email).not.toBe(adminB.email);

    const meAsB = await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${sessionB.sessionToken}`)
      .expect(200);
    expect(meAsB.body.email).toBe(adminB.email);
    expect(meAsB.body.id).not.toBe(meAsA.body.id);

    // The defining property: A's token resolves ONLY to A, never to B, and
    // vice versa — same role on both accounts, no role-based conflation.
    expect(meAsA.body.role).toBe(meAsB.body.role);
    expect(meAsA.body.id).not.toBe(meAsB.body.id);
  }, 30_000);

  it('LOGOUT — issues a session, confirms it works, logs out, then immediate reuse of the SAME token is rejected generically (401)', async () => {
    const { email, secret } = await seedAdmin('logout', 'a-long-enough-password-9');
    const session = await fullLogin(email, 'a-long-enough-password-9', secret);

    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/admin/auth/logout')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(204);

    const reuse = await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(401);

    // Same generic shape as every other invalid-session reason — logout
    // must not be distinguishable from expiry/revocation/unknown-token.
    const unauthenticated = await request(app.getHttpServer()).get('/admin/auth/me').expect(401);
    expect(reuse.body.message).toEqual(unauthenticated.body.message);

    const revoked = await prisma.adminSession.findFirstOrThrow({
      where: { admin: { email } },
    });
    expect(revoked.revokedAt).not.toBeNull();
  }, 30_000);

  it('ADVERSARIAL / SERVER-SIDE ENFORCEMENT — a session revoked by a means other than the logout endpoint (direct state change, simulating what an out-of-band or malicious action would produce) is STILL rejected by the server, proving rejection is not contingent on how or where revocation happened', async () => {
    const { email, secret } = await seedAdmin('adversarial-revoked', 'a-long-enough-password-10');
    const session = await fullLogin(email, 'a-long-enough-password-10', secret);

    // Bypasses the application layer entirely — nothing in this request path
    // (including the logout endpoint) is what marks the session revoked;
    // this proves the guard's rejection is driven purely by server-side
    // database state, never by any client-observable signal or by trusting
    // that revocation only ever happens through the logout code path.
    await prisma.adminSession.updateMany({
      where: { admin: { email } },
      data: { revokedAt: new Date() },
    });

    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(401);
  }, 30_000);

  it('CONCURRENT LOGOUT RACE — two simultaneous logout calls with the same session token never crash and never produce a 5xx; the token is unusable immediately afterward either way', async () => {
    const { email, secret } = await seedAdmin('logout-race', 'a-long-enough-password-11');
    const session = await fullLogin(email, 'a-long-enough-password-11', secret);

    const [resultA, resultB] = await Promise.all([
      request(app.getHttpServer())
        .post('/admin/auth/logout')
        .set('Authorization', `Bearer ${session.sessionToken}`),
      request(app.getHttpServer())
        .post('/admin/auth/logout')
        .set('Authorization', `Bearer ${session.sessionToken}`),
    ]);

    // revoke() is an unconditional, idempotent write (not a one-time-use
    // consume like AUTH-003's refresh rotation) — both concurrent callers
    // may legitimately observe the session as still-active and both
    // successfully revoke it; what must hold is that neither request ever
    // fails with a server error, and the end state is deterministic.
    expect([200, 204, 401]).toContain(resultA.status);
    expect([200, 204, 401]).toContain(resultB.status);
    expect(resultA.status).toBeLessThan(500);
    expect(resultB.status).toBeLessThan(500);

    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(401);
  }, 30_000);
});
