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

import { AdminAuthHttpModule } from '../admin-auth/admin-auth-http.module';
import { AdminElevationHttpModule } from './admin-elevation-http.module';

/**
 * Same shape as `api-token.e2e.spec.ts` — a local module list mirroring
 * `apps/api/src/app.module.ts` minus `HealthModule` (pre-existing, unrelated
 * `TerminusModule`/`@nestjs/testing` incompatibility, documented on
 * `admin-auth.e2e.spec.ts`). `AdminAuthHttpModule` is imported alongside
 * `AdminElevationHttpModule` for the SAME reason `api-token.e2e.spec.ts`
 * already documents: this suite needs the real `/admin/auth/login` +
 * `/admin/auth/mfa/verify` HTTP flow to obtain genuine authenticated
 * sessions (`AdminSessionGuard`-protected routes are exercised, never
 * shortcut around).
 */
@Module({
  imports: [
    AppConfigModule.forRoot(),
    AppLoggerModule.forRoot('afa-api-e2e-test'),
    PrismaModule,
    RedisModule,
    AdminAuthHttpModule,
    AdminElevationHttpModule,
  ],
})
class AdminElevationE2eAppModule {}

/**
 * TASK-AUTH-005 — the `admin` -> `super_admin` elevation-approval flow, real
 * Postgres + real Redis (MFA challenge storage), full real HTTP surface.
 *
 * BOOTSTRAPPING NOTE: `BootstrapAdminUseCase` (TASK-AUTH-002, unmodified)
 * always provisions `role: 'super_admin'` — there is no production code
 * path that creates an `admin`-role account at all. This suite bootstraps
 * admins the normal way (always `super_admin`) and, ONLY where an `admin`-role
 * fixture is needed, downgrades one directly via Prisma immediately after
 * bootstrap — test-fixture DB manipulation, the same established pattern
 * `admin-auth.e2e.spec.ts` already uses for `lastActiveAt`/`expiresAt`, not
 * a production "demote" feature.
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
  return `auth005-e2e-${label}-${randomBytes(4).toString('hex')}@example.invalid`;
}

describe('Admin Elevation — protected-route end-to-end (real Postgres + real Redis)', () => {
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
      imports: [AdminElevationE2eAppModule],
    }).compile();
    app = appModuleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    if (prisma && seededEmails.length > 0) {
      await prisma.adminElevationRequest.deleteMany({
        where: { targetAdmin: { email: { in: seededEmails } } },
      });
      await prisma.adminSession.deleteMany({ where: { admin: { email: { in: seededEmails } } } });

      // Any admin who successfully acted as an APPROVER is permanently
      // referenced by `audit_log.actor_id` (ON DELETE RESTRICT, audit_log
      // itself is undeletable) — only delete the subset NOT referenced,
      // same as `prisma-admin-elevation.repository.integration.spec.ts`.
      const seededAdmins = await prisma.admin.findMany({
        where: { email: { in: seededEmails } },
        select: { id: true },
      });
      const seededAdminIds = seededAdmins.map((a) => a.id);
      const permanentlyReferenced = await prisma.auditLog.findMany({
        where: { actorId: { in: seededAdminIds } },
        select: { actorId: true },
      });
      const undeletableIds = new Set(permanentlyReferenced.map((row) => row.actorId));
      const deletableIds = seededAdminIds.filter((id) => !undeletableIds.has(id));
      if (deletableIds.length > 0) {
        await prisma.admin.deleteMany({ where: { id: { in: deletableIds } } });
      }
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
    role: 'admin' | 'super_admin' = 'super_admin',
  ): Promise<{ id: string; email: string; secret: string }> {
    const email = uniqueEmail(label);
    seededEmails.push(email);
    const bootstrap = bootstrapContext.get(BootstrapAdminUseCase);
    const { admin, otpauthUrl } = await bootstrap.execute({ email, password });
    if (role !== 'super_admin') {
      await prisma.admin.update({ where: { id: admin.id }, data: { role } });
    }
    return { id: admin.id, email, secret: extractTotpSecret(otpauthUrl) };
  }

  async function fullLogin(email: string, password: string, secret: string): Promise<string> {
    const loginRes = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password })
      .expect(200);
    const code = await generate({ secret });
    const verifyRes = await request(app.getHttpServer())
      .post('/admin/auth/mfa/verify')
      .send({ challengeToken: loginRes.body.challengeToken, code })
      .expect(200);
    return verifyRes.body.sessionToken as string;
  }

  it('COMPLETE FLOW — a target admin requests elevation; a DIFFERENT super_admin approves it; the target becomes super_admin', async () => {
    const target = await seedAdmin('flow-target', 'a-long-enough-password-t1', 'admin');
    const approver = await seedAdmin('flow-approver', 'a-long-enough-password-a1', 'super_admin');
    const targetToken = await fullLogin(target.email, 'a-long-enough-password-t1', target.secret);
    const approverToken = await fullLogin(
      approver.email,
      'a-long-enough-password-a1',
      approver.secret,
    );

    const requestRes = await request(app.getHttpServer())
      .post('/admin/rbac/elevation-requests')
      .set('Authorization', `Bearer ${targetToken}`)
      .expect(201);
    const requestId = requestRes.body.requestId as string;
    expect(requestId).toBeDefined();

    await request(app.getHttpServer())
      .post(`/admin/rbac/elevation-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(204);

    const updated = await prisma.admin.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.role).toBe('super_admin');
  }, 30_000);

  it('SELF-ELEVATION REJECTED — the target admin cannot approve their own request, even though they hold a valid session', async () => {
    const target = await seedAdmin('self-elevation', 'a-long-enough-password-t2', 'admin');
    const targetToken = await fullLogin(target.email, 'a-long-enough-password-t2', target.secret);

    const requestRes = await request(app.getHttpServer())
      .post('/admin/rbac/elevation-requests')
      .set('Authorization', `Bearer ${targetToken}`)
      .expect(201);
    const requestId = requestRes.body.requestId as string;

    // The target is not a super_admin, so RequireSuperAdminGuard rejects
    // first — proving the role gate itself, not the use-case's own
    // self-elevation check, is what stops this specific attempt.
    await request(app.getHttpServer())
      .post(`/admin/rbac/elevation-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${targetToken}`)
      .expect(403);

    const unchanged = await prisma.admin.findUniqueOrThrow({ where: { id: target.id } });
    expect(unchanged.role).toBe('admin');
  }, 30_000);

  it('SELF-ELEVATION REJECTED even for an already-super_admin caller approving their OWN request (defense-in-depth in the use-case itself, not only the role guard)', async () => {
    // A super_admin who somehow has a pending request naming themselves
    // (not reachable via RequestAdminElevationUseCase's own eligibility
    // check today, but exercised directly here to prove the use-case-level
    // guard is real and not merely incidental to the role gate).
    const admin = await seedAdmin('self-super', 'a-long-enough-password-t3', 'super_admin');
    const token = await fullLogin(admin.email, 'a-long-enough-password-t3', admin.secret);
    const selfTargetingRequest = await prisma.adminElevationRequest.create({
      data: { targetAdminId: admin.id, expiresAt: new Date(Date.now() + 60_000) },
    });

    await request(app.getHttpServer())
      .post(`/admin/rbac/elevation-requests/${selfTargetingRequest.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const stillPending = await prisma.adminElevationRequest.findUniqueOrThrow({
      where: { id: selfTargetingRequest.id },
    });
    expect(stillPending.resolvedAt).toBeNull();
  }, 30_000);

  it("UNAUTHORIZED ROLE — an admin-role caller (not the target, not a super_admin) cannot approve anyone's elevation request", async () => {
    const target = await seedAdmin('unauth-target', 'a-long-enough-password-t4', 'admin');
    const bystander = await seedAdmin('unauth-bystander', 'a-long-enough-password-b4', 'admin');
    const targetToken = await fullLogin(target.email, 'a-long-enough-password-t4', target.secret);
    const bystanderToken = await fullLogin(
      bystander.email,
      'a-long-enough-password-b4',
      bystander.secret,
    );

    const requestRes = await request(app.getHttpServer())
      .post('/admin/rbac/elevation-requests')
      .set('Authorization', `Bearer ${targetToken}`)
      .expect(201);
    const requestId = requestRes.body.requestId as string;

    await request(app.getHttpServer())
      .post(`/admin/rbac/elevation-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${bystanderToken}`)
      .expect(403);
  }, 30_000);

  it('STALE REQUEST — an expired elevation request is rejected generically, same shape as any other invalid request', async () => {
    const target = await seedAdmin('stale-target', 'a-long-enough-password-t5', 'admin');
    const approver = await seedAdmin('stale-approver', 'a-long-enough-password-a5', 'super_admin');
    const approverToken = await fullLogin(
      approver.email,
      'a-long-enough-password-a5',
      approver.secret,
    );
    const staleRequest = await prisma.adminElevationRequest.create({
      data: { targetAdminId: target.id, expiresAt: new Date(Date.now() - 1_000) },
    });

    const staleRes = await request(app.getHttpServer())
      .post(`/admin/rbac/elevation-requests/${staleRequest.id}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(403);

    const unknownIdRes = await request(app.getHttpServer())
      .post(`/admin/rbac/elevation-requests/00000000-0000-0000-0000-000000000000/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(403);

    // Generic error behavior — expired and never-existed produce the SAME shape.
    expect(staleRes.body.message).toEqual(unknownIdRes.body.message);
  }, 30_000);

  it('REPLAY REJECTED — an already-approved request cannot be approved again', async () => {
    const target = await seedAdmin('replay-target', 'a-long-enough-password-t6', 'admin');
    const approver = await seedAdmin('replay-approver', 'a-long-enough-password-a6', 'super_admin');
    const targetToken = await fullLogin(target.email, 'a-long-enough-password-t6', target.secret);
    const approverToken = await fullLogin(
      approver.email,
      'a-long-enough-password-a6',
      approver.secret,
    );

    const requestRes = await request(app.getHttpServer())
      .post('/admin/rbac/elevation-requests')
      .set('Authorization', `Bearer ${targetToken}`)
      .expect(201);
    const requestId = requestRes.body.requestId as string;

    await request(app.getHttpServer())
      .post(`/admin/rbac/elevation-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(204);

    // Replay: the SAME request id, approved again.
    await request(app.getHttpServer())
      .post(`/admin/rbac/elevation-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(403);
  }, 30_000);

  it('CONCURRENT APPROVAL RACE — two simultaneous approve calls for the same request: exactly one 204, the other a safe non-5xx rejection, role set exactly once', async () => {
    const target = await seedAdmin('race-target', 'a-long-enough-password-t7', 'admin');
    const approver = await seedAdmin('race-approver', 'a-long-enough-password-a7', 'super_admin');
    const targetToken = await fullLogin(target.email, 'a-long-enough-password-t7', target.secret);
    const approverToken = await fullLogin(
      approver.email,
      'a-long-enough-password-a7',
      approver.secret,
    );

    const requestRes = await request(app.getHttpServer())
      .post('/admin/rbac/elevation-requests')
      .set('Authorization', `Bearer ${targetToken}`)
      .expect(201);
    const requestId = requestRes.body.requestId as string;

    const [resultA, resultB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/admin/rbac/elevation-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${approverToken}`),
      request(app.getHttpServer())
        .post(`/admin/rbac/elevation-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${approverToken}`),
    ]);
    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual([204, 403]);

    const updated = await prisma.admin.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.role).toBe('super_admin');
  }, 30_000);

  it('SUPER_ADMIN CEILING — an already-super_admin caller cannot request further elevation (no elevation path exists above super_admin)', async () => {
    const admin = await seedAdmin('ceiling', 'a-long-enough-password-t8', 'super_admin');
    const token = await fullLogin(admin.email, 'a-long-enough-password-t8', admin.secret);

    await request(app.getHttpServer())
      .post('/admin/rbac/elevation-requests')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  }, 30_000);

  it("CROSS-IDENTITY ISOLATION — approving one admin's elevation request never affects a different, unrelated admin", async () => {
    const targetA = await seedAdmin('isolation-a', 'a-long-enough-password-t9', 'admin');
    const targetB = await seedAdmin('isolation-b', 'a-long-enough-password-b9', 'admin');
    const approver = await seedAdmin(
      'isolation-approver',
      'a-long-enough-password-a9',
      'super_admin',
    );
    const tokenA = await fullLogin(targetA.email, 'a-long-enough-password-t9', targetA.secret);
    const approverToken = await fullLogin(
      approver.email,
      'a-long-enough-password-a9',
      approver.secret,
    );

    const requestRes = await request(app.getHttpServer())
      .post('/admin/rbac/elevation-requests')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/rbac/elevation-requests/${requestRes.body.requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(204);

    const updatedA = await prisma.admin.findUniqueOrThrow({ where: { id: targetA.id } });
    const untouchedB = await prisma.admin.findUniqueOrThrow({ where: { id: targetB.id } });
    expect(updatedA.role).toBe('super_admin');
    expect(untouchedB.role).toBe('admin');
  }, 30_000);
});
