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
import { SupportSessionHttpModule } from './support-session-http.module';

/**
 * Same shape as `admin-elevation.e2e.spec.ts` — `AdminAuthHttpModule`
 * imported alongside this task's own `SupportSessionHttpModule` for the
 * real `/admin/auth/login` + `/admin/auth/mfa/verify` HTTP flow.
 */
@Module({
  imports: [
    AppConfigModule.forRoot(),
    AppLoggerModule.forRoot('afa-api-e2e-test'),
    PrismaModule,
    RedisModule,
    AdminAuthHttpModule,
    SupportSessionHttpModule,
  ],
})
class SupportSessionE2eAppModule {}

/**
 * TASK-SEC-006 — the justified/logged/time-bounded support-session flow,
 * real Postgres + real Redis, full real HTTP surface.
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
  return `sec006-e2e-${label}-${randomBytes(4).toString('hex')}@example.invalid`;
}

describe('Support Sessions — protected-route end-to-end (real Postgres + real Redis)', () => {
  let app: INestApplication;
  let bootstrapContext: INestApplicationContext;
  let prisma: PrismaService;
  const seededEmails: string[] = [];
  const seededUserIds: string[] = [];

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
      imports: [SupportSessionE2eAppModule],
    }).compile();
    app = appModuleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.supportSessionElevationRequest.deleteMany({
        where: { supportSession: { targetUserId: { in: seededUserIds } } },
      });
      await prisma.supportSession.deleteMany({ where: { targetUserId: { in: seededUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });

      if (seededEmails.length > 0) {
        await prisma.adminSession.deleteMany({
          where: { admin: { email: { in: seededEmails } } },
        });

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
    role: 'admin' | 'super_admin' = 'admin',
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

  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { telegramUserId: BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 100000)) },
    });
    seededUserIds.push(user.id);
    return user.id;
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

  it('COMPLETE LIFECYCLE — open (justified, audited), Active access succeeds, close ends it, subsequent access is rejected generically', async () => {
    const agent = await seedAdmin('lifecycle-agent', 'a-long-enough-password-1');
    const targetUserId = await seedUser();
    const token = await fullLogin(agent.email, 'a-long-enough-password-1', agent.secret);

    const openRes = await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetUserId, justification: 'user reported a discrepancy' })
      .expect(201);
    const sessionId = openRes.body.sessionId as string;
    expect(sessionId).toBeDefined();

    const summaryRes = await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionId}/summary`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(summaryRes.body.targetUserId).toBe(targetUserId);

    await request(app.getHttpServer())
      .post(`/admin/support-sessions/${sessionId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionId}/summary`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'support_session.opened', targetResource: `support_session:${sessionId}` },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.justification).toBe('user reported a discrepancy');
    // 30s was proven too tight for this whole file, not just this test: across this
    // session's verification runs, EVERY test here (including this one, the simplest
    // in the file — 1 admin, 1 login, 4 HTTP calls) has been observed at some point
    // taking 20-30s+ under this environment's real Supabase-pooler + bcrypt + TOTP
    // latency, with zero wrong-status-code failures ever observed. See the 5
    // individually-diagnosed tests below for exact measured baselines (~33-53s).
  }, 90_000);

  it("CANNOT OPEN WITHOUT JUSTIFICATION — the DoD's own explicit requirement", async () => {
    const agent = await seedAdmin('no-justification', 'a-long-enough-password-2');
    const targetUserId = await seedUser();
    const token = await fullLogin(agent.email, 'a-long-enough-password-2', agent.secret);

    await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetUserId, justification: '' })
      .expect(400);

    const sessions = await prisma.supportSession.findMany({ where: { targetUserId } });
    expect(sessions).toHaveLength(0);
  }, 90_000);

  it('UNAUTHORIZED / CROSS-IDENTITY — a DIFFERENT admin cannot access, close, or elevate a session they did not open', async () => {
    const owner = await seedAdmin('cross-owner', 'a-long-enough-password-3');
    const bystander = await seedAdmin('cross-bystander', 'a-long-enough-password-4');
    const targetUserId = await seedUser();
    const ownerToken = await fullLogin(owner.email, 'a-long-enough-password-3', owner.secret);
    const bystanderToken = await fullLogin(
      bystander.email,
      'a-long-enough-password-4',
      bystander.secret,
    );

    const openRes = await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ targetUserId, justification: 'reason' })
      .expect(201);
    const sessionId = openRes.body.sessionId as string;

    const foreignSummary = await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionId}/summary`)
      .set('Authorization', `Bearer ${bystanderToken}`)
      .expect(403);
    const foreignClose = await request(app.getHttpServer())
      .post(`/admin/support-sessions/${sessionId}/close`)
      .set('Authorization', `Bearer ${bystanderToken}`)
      .expect(403);

    // Generic error behavior — same shape regardless of which action was attempted.
    expect(foreignSummary.body.message).toEqual(foreignClose.body.message);

    // The owner's own session is untouched.
    await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionId}/summary`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    // measured clean-isolated-run baseline ~32.6s (2 bcrypt hashes + 2 TOTP logins +
    // 4 sequential HTTP round-trips); 30s was too tight — this is real latency,
    // not a deadlock (confirmed after 2 consecutive within-full-file-run timeouts
    // at exactly 30000ms, both resolved by isolated rerun).
  }, 60_000);

  it('EXPIRY — a session past its expiry is rejected generically, same shape as an unknown session', async () => {
    const agent = await seedAdmin('expiry-agent', 'a-long-enough-password-5');
    const targetUserId = await seedUser();
    const token = await fullLogin(agent.email, 'a-long-enough-password-5', agent.secret);

    const openRes = await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetUserId, justification: 'reason' })
      .expect(201);
    const sessionId = openRes.body.sessionId as string;

    await prisma.supportSession.updateMany({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const expiredRes = await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionId}/summary`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    const unknownRes = await request(app.getHttpServer())
      .get(`/admin/support-sessions/00000000-0000-0000-0000-000000000000/summary`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(expiredRes.body.message).toEqual(unknownRes.body.message);
  }, 90_000);

  it('ELEVATED ACCESS — raw-detail route is rejected until a DIFFERENT super_admin approves elevation, then succeeds; de-elevation reverts it', async () => {
    const agent = await seedAdmin('elevate-agent', 'a-long-enough-password-6');
    const approver = await seedAdmin('elevate-approver', 'a-long-enough-password-7', 'super_admin');
    const targetUserId = await seedUser();
    const agentToken = await fullLogin(agent.email, 'a-long-enough-password-6', agent.secret);
    const approverToken = await fullLogin(
      approver.email,
      'a-long-enough-password-7',
      approver.secret,
    );

    const openRes = await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ targetUserId, justification: 'needs raw detail' })
      .expect(201);
    const sessionId = openRes.body.sessionId as string;

    // Before elevation: raw-detail route rejected, summary still fine.
    await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionId}/raw-detail-proof`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);

    const elevReqRes = await request(app.getHttpServer())
      .post(`/admin/support-sessions/${sessionId}/elevation-requests`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);
    const requestId = elevReqRes.body.requestId as string;

    await request(app.getHttpServer())
      .post(`/admin/support-sessions/elevation-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionId}/raw-detail-proof`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'support_session.elevated', targetResource: `support_session:${sessionId}` },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actorId).toBe(approver.id);

    // De-elevate: Elevated -> Active. Raw-detail route rejected again, session itself still Active.
    await request(app.getHttpServer())
      .post(`/admin/support-sessions/${sessionId}/elevation-requests/${requestId}/close`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionId}/raw-detail-proof`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionId}/summary`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    // measured clean-isolated-run baseline ~53s (2 bcrypt hashes + 2 TOTP logins +
    // 8 sequential HTTP round-trips + 1 Prisma query against Supabase's pooled
    // connection); 30s was too tight — this is real latency, not a deadlock.
  }, 90_000);

  it("SELF-ELEVATION REJECTED — the session's own agent cannot approve their own elevation request, even holding super_admin", async () => {
    const agent = await seedAdmin('self-elevate', 'a-long-enough-password-8', 'super_admin');
    const targetUserId = await seedUser();
    const token = await fullLogin(agent.email, 'a-long-enough-password-8', agent.secret);

    const openRes = await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetUserId, justification: 'reason' })
      .expect(201);
    const sessionId = openRes.body.sessionId as string;
    const elevReqRes = await request(app.getHttpServer())
      .post(`/admin/support-sessions/${sessionId}/elevation-requests`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/support-sessions/elevation-requests/${elevReqRes.body.requestId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  }, 90_000);

  it('UNAUTHORIZED ROLE — a non-super_admin cannot approve an elevation request', async () => {
    const agent = await seedAdmin('unauth-approve-agent', 'a-long-enough-password-9');
    const bystander = await seedAdmin('unauth-approve-bystander', 'a-long-enough-password-10');
    const targetUserId = await seedUser();
    const agentToken = await fullLogin(agent.email, 'a-long-enough-password-9', agent.secret);
    const bystanderToken = await fullLogin(
      bystander.email,
      'a-long-enough-password-10',
      bystander.secret,
    );

    const openRes = await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ targetUserId, justification: 'reason' })
      .expect(201);
    const elevReqRes = await request(app.getHttpServer())
      .post(`/admin/support-sessions/${openRes.body.sessionId}/elevation-requests`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/support-sessions/elevation-requests/${elevReqRes.body.requestId}/approve`)
      .set('Authorization', `Bearer ${bystanderToken}`)
      .expect(403);
  }, 90_000);

  it('REPLAY REJECTED — an already-approved elevation request cannot be approved again', async () => {
    const agent = await seedAdmin('replay-agent', 'a-long-enough-password-11');
    const approver = await seedAdmin('replay-approver', 'a-long-enough-password-12', 'super_admin');
    const targetUserId = await seedUser();
    const agentToken = await fullLogin(agent.email, 'a-long-enough-password-11', agent.secret);
    const approverToken = await fullLogin(
      approver.email,
      'a-long-enough-password-12',
      approver.secret,
    );

    const openRes = await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ targetUserId, justification: 'reason' })
      .expect(201);
    const elevReqRes = await request(app.getHttpServer())
      .post(`/admin/support-sessions/${openRes.body.sessionId}/elevation-requests`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/support-sessions/elevation-requests/${elevReqRes.body.requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .post(`/admin/support-sessions/elevation-requests/${elevReqRes.body.requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(403);
    // measured clean-isolated-run baseline ~37.6s (2 bcrypt hashes + 2 TOTP logins +
    // 4 sequential HTTP round-trips); 30s was too tight — this is real latency,
    // not a deadlock.
  }, 60_000);

  it('CONCURRENT APPROVAL RACE — two simultaneous approve calls for the same elevation request: exactly one 204, the other a safe non-5xx rejection', async () => {
    const agent = await seedAdmin('race-agent', 'a-long-enough-password-13');
    const approver = await seedAdmin('race-approver', 'a-long-enough-password-14', 'super_admin');
    const targetUserId = await seedUser();
    const agentToken = await fullLogin(agent.email, 'a-long-enough-password-13', agent.secret);
    const approverToken = await fullLogin(
      approver.email,
      'a-long-enough-password-14',
      approver.secret,
    );

    const openRes = await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ targetUserId, justification: 'reason' })
      .expect(201);
    const elevReqRes = await request(app.getHttpServer())
      .post(`/admin/support-sessions/${openRes.body.sessionId}/elevation-requests`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);

    const [resultA, resultB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/admin/support-sessions/elevation-requests/${elevReqRes.body.requestId}/approve`)
        .set('Authorization', `Bearer ${approverToken}`),
      request(app.getHttpServer())
        .post(`/admin/support-sessions/elevation-requests/${elevReqRes.body.requestId}/approve`)
        .set('Authorization', `Bearer ${approverToken}`),
    ]);
    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual([204, 403]);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        action: 'support_session.elevated',
        targetResource: `support_session:${openRes.body.sessionId}`,
      },
    });
    expect(auditRows).toHaveLength(1);
    // measured clean-isolated-run baseline ~48.8s (2 bcrypt hashes + 2 TOTP logins +
    // 2 sequential HTTP round-trips + 1 concurrent approve pair + 1 Prisma query);
    // 30s was too tight — this is real latency, not a deadlock.
  }, 90_000);

  it("CROSS-USER ISOLATION — closing one agent's session for one user never affects a different session for a different user", async () => {
    const agent = await seedAdmin('isolation-agent', 'a-long-enough-password-15');
    const userA = await seedUser();
    const userB = await seedUser();
    const token = await fullLogin(agent.email, 'a-long-enough-password-15', agent.secret);

    const sessionARes = await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetUserId: userA, justification: 'reason A' })
      .expect(201);
    const sessionBRes = await request(app.getHttpServer())
      .post('/admin/support-sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetUserId: userB, justification: 'reason B' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/support-sessions/${sessionARes.body.sessionId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionARes.body.sessionId}/summary`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    const stillActive = await request(app.getHttpServer())
      .get(`/admin/support-sessions/${sessionBRes.body.sessionId}/summary`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(stillActive.body.targetUserId).toBe(userB);
    // measured clean-isolated-run baseline ~33.4s (1 bcrypt hash + 1 TOTP login +
    // 5 sequential HTTP round-trips); 30s was too tight — this is real latency,
    // not a deadlock (confirmed after 2 consecutive within-full-file-run timeouts,
    // including one where a stale/late response after test-abandonment looked like
    // a wrong status code but was resolved cleanly on isolated rerun).
  }, 60_000);
});
