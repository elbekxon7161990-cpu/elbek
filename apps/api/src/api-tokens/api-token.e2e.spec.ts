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
  AllExceptionsFilter,
  AppConfigModule,
  AppLoggerModule,
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
import { ApiTokenHttpModule } from './api-token-http.module';

/**
 * TASK-AUTH-003 — the "deliberate revocation test" this task's Definition
 * of Done requires (issue → protected route succeeds → revoke →
 * IMMEDIATE reuse must fail), plus rotation/replay/race/expiry/scope
 * proofs. Real Postgres + real Redis, the full real HTTP surface — no
 * mocks, no fakes. Same `HealthModule`-exclusion and two-separate-NestJS-
 * context shape as `admin-auth.e2e.spec.ts` (see that file's own doc
 * comment for why); this suite additionally needs a REAL authenticated
 * admin session (obtained via the actual `/admin/auth/login` +
 * `/admin/auth/mfa/verify` HTTP flow, never a shortcut) since token
 * issuance/revocation are `AdminSessionGuard`-protected. One admin session
 * is created once in `beforeAll` and reused across every test in this file
 * to minimize round trips against the remote pooled Postgres connection —
 * see [[project_afa_live_staging_db]]-style caution around this.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MFA_SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

@Module({
  imports: [
    AppConfigModule.forRoot(),
    AppLoggerModule.forRoot('afa-api-apitoken-e2e-test'),
    PrismaModule,
    RedisModule,
    AdminAuthHttpModule,
    ApiTokenHttpModule,
  ],
})
class ApiTokenE2eAppModule {}

function extractTotpSecret(otpauthUrl: string): string {
  const secret = new URL(otpauthUrl).searchParams.get('secret');
  if (!secret) {
    throw new Error(`otpauth URL carried no secret param: ${otpauthUrl}`);
  }
  return secret;
}

function uniqueAdminEmail(label: string): string {
  return `auth003-e2e-admin-${label}-${randomBytes(4).toString('hex')}@example.invalid`;
}

function uniqueClientId(label: string): string {
  return `auth003-e2e-client-${label}-${randomBytes(4).toString('hex')}`;
}

describe('API Token Lifecycle — protected-route end-to-end (real Postgres + real Redis)', () => {
  let app: INestApplication;
  let bootstrapContext: INestApplicationContext;
  let prisma: PrismaService;
  let adminBearerToken: string;
  const seededAdminEmails: string[] = [];
  const seededClientIdentifiers: string[] = [];

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
      imports: [ApiTokenE2eAppModule],
    }).compile();
    app = appModuleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);

    // Bootstrap one admin and complete a REAL password+MFA login through
    // the actual HTTP surface, exactly as a human operator would — no
    // shortcut, no direct repository/session-token fabrication.
    const email = uniqueAdminEmail('shared');
    seededAdminEmails.push(email);
    const password = 'a-long-enough-password-e2e';
    const bootstrap = bootstrapContext.get(BootstrapAdminUseCase);
    const { otpauthUrl } = await bootstrap.execute({ email, password });
    const secret = extractTotpSecret(otpauthUrl);

    const loginRes = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password })
      .expect(200);
    const code = await generate({ secret });
    const verifyRes = await request(app.getHttpServer())
      .post('/admin/auth/mfa/verify')
      .send({ challengeToken: loginRes.body.challengeToken, code })
      .expect(200);
    adminBearerToken = verifyRes.body.sessionToken;
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      if (seededClientIdentifiers.length > 0) {
        await prisma.apiToken.deleteMany({
          where: { clientIdentifier: { in: seededClientIdentifiers } },
        });
      }
      if (seededAdminEmails.length > 0) {
        await prisma.adminSession.deleteMany({
          where: { admin: { email: { in: seededAdminEmails } } },
        });
        await prisma.admin.deleteMany({ where: { email: { in: seededAdminEmails } } });
      }
    }
    if (bootstrapContext) {
      await bootstrapContext.close();
    }
    if (app) {
      await app.close();
    }
  }, 30_000);

  async function issueToken(
    label: string,
    scope: string[] = ['transactions:read'],
  ): Promise<{
    clientIdentifier: string;
    accessTokenId: string;
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshTokenId: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
  }> {
    const clientIdentifier = uniqueClientId(label);
    seededClientIdentifiers.push(clientIdentifier);
    const res = await request(app.getHttpServer())
      .post('/admin/api-tokens')
      .set('Authorization', `Bearer ${adminBearerToken}`)
      .send({ clientIdentifier, scope })
      .expect(201);
    return res.body;
  }

  it('rejects an unauthenticated request to the protected route', async () => {
    await request(app.getHttpServer()).get('/admin/api-tokens/whoami').expect(401);
  });

  it('issues a token and the access token reaches the protected route (whoami)', async () => {
    const issued = await issueToken('issue-whoami');
    const res = await request(app.getHttpServer())
      .get('/admin/api-tokens/whoami')
      .set('Authorization', `Bearer ${issued.accessToken}`)
      .expect(200);
    expect(res.body).toEqual({
      clientIdentifier: issued.clientIdentifier,
      scope: ['transactions:read'],
    });
  }, 20_000);

  it('parentTokenId: the access token references the refresh token that issued it', async () => {
    const issued = await issueToken('parent-link');
    const accessRow = await prisma.apiToken.findUniqueOrThrow({
      where: { id: issued.accessTokenId },
    });
    const refreshRow = await prisma.apiToken.findUniqueOrThrow({
      where: { id: issued.refreshTokenId },
    });
    expect(accessRow.parentTokenId).toBe(refreshRow.id);
    expect(refreshRow.parentTokenId).toBeNull();
  }, 20_000);

  it('refresh token expiry is exactly 30 days from issuance', async () => {
    const before = Date.now();
    const issued = await issueToken('refresh-ttl');
    const after = Date.now();
    const expiresAtMs = new Date(issued.refreshTokenExpiresAt).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + thirtyDaysMs - 5_000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + thirtyDaysMs + 5_000);
  }, 20_000);

  it('access token expiry matches the ~24h admin-session absolute posture', async () => {
    const before = Date.now();
    const issued = await issueToken('access-ttl');
    const after = Date.now();
    const expiresAtMs = new Date(issued.accessTokenExpiresAt).getTime();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + twentyFourHoursMs - 5_000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + twentyFourHoursMs + 5_000);
  }, 20_000);

  it('DELIBERATE REVOCATION TEST — issue, succeed at the protected route, revoke, then the SAME access token is rejected on its very next use', async () => {
    const issued = await issueToken('revocation');

    await request(app.getHttpServer())
      .get('/admin/api-tokens/whoami')
      .set('Authorization', `Bearer ${issued.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/admin/api-tokens/${issued.accessTokenId}`)
      .set('Authorization', `Bearer ${adminBearerToken}`)
      .expect(204);

    // Immediately — the very next use of this exact access token.
    await request(app.getHttpServer())
      .get('/admin/api-tokens/whoami')
      .set('Authorization', `Bearer ${issued.accessToken}`)
      .expect(401);
  }, 20_000);

  it('rejects an expired access token', async () => {
    const issued = await issueToken('expired-access');
    await prisma.apiToken.update({
      where: { id: issued.accessTokenId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await request(app.getHttpServer())
      .get('/admin/api-tokens/whoami')
      .set('Authorization', `Bearer ${issued.accessToken}`)
      .expect(401);
  }, 20_000);

  it('valid refresh issues a new access+refresh pair carrying the SAME scope (scope preservation), and the old refresh token cannot be replayed', async () => {
    const issued = await issueToken('refresh-flow', ['transactions:read', 'budgets:write']);

    const refreshRes = await request(app.getHttpServer())
      .post('/admin/api-tokens/refresh')
      .send({ refreshToken: issued.refreshToken })
      .expect(200);
    expect(refreshRes.body.accessToken).not.toBe(issued.accessToken);
    expect(refreshRes.body.refreshToken).not.toBe(issued.refreshToken);

    const newAccessRes = await request(app.getHttpServer())
      .get('/admin/api-tokens/whoami')
      .set('Authorization', `Bearer ${refreshRes.body.accessToken}`)
      .expect(200);
    expect(newAccessRes.body.scope).toEqual(['transactions:read', 'budgets:write']);

    // Replay of the OLD (already-rotated) refresh token must fail.
    const replayRes = await request(app.getHttpServer())
      .post('/admin/api-tokens/refresh')
      .send({ refreshToken: issued.refreshToken })
      .expect(401);
    expect(replayRes.body).toBeDefined();

    // parentTokenId chain: new refresh -> old refresh; new access -> new refresh.
    const newAccessRow = await prisma.apiToken.findFirst({
      where: {
        clientIdentifier: issued.clientIdentifier,
        tokenType: 'access',
        id: { not: issued.accessTokenId },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(newAccessRow?.parentTokenId).not.toBeNull();
    if (newAccessRow?.parentTokenId) {
      const newRefreshRow = await prisma.apiToken.findUniqueOrThrow({
        where: { id: newAccessRow.parentTokenId },
      });
      expect(newRefreshRow.parentTokenId).toBe(issued.refreshTokenId);
    }
  }, 30_000);

  it('rejects an expired refresh token', async () => {
    const issued = await issueToken('expired-refresh');
    await prisma.apiToken.update({
      where: { id: issued.refreshTokenId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await request(app.getHttpServer())
      .post('/admin/api-tokens/refresh')
      .send({ refreshToken: issued.refreshToken })
      .expect(401);
  }, 20_000);

  it('rejects a revoked refresh token (revoked via the admin DELETE endpoint)', async () => {
    const issued = await issueToken('revoked-refresh');
    await request(app.getHttpServer())
      .delete(`/admin/api-tokens/${issued.refreshTokenId}`)
      .set('Authorization', `Bearer ${adminBearerToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .post('/admin/api-tokens/refresh')
      .send({ refreshToken: issued.refreshToken })
      .expect(401);
  }, 20_000);

  it('generic 401: an unknown refresh token and an expired refresh token produce the SAME response shape (no leak)', async () => {
    const issued = await issueToken('generic-401-refresh');
    await prisma.apiToken.update({
      where: { id: issued.refreshTokenId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expiredRes = await request(app.getHttpServer())
      .post('/admin/api-tokens/refresh')
      .send({ refreshToken: issued.refreshToken })
      .expect(401);
    const unknownRes = await request(app.getHttpServer())
      .post('/admin/api-tokens/refresh')
      .send({ refreshToken: 'totally-unknown-refresh-token' })
      .expect(401);
    expect(expiredRes.body.message).toEqual(unknownRes.body.message);
  }, 20_000);

  it('CONCURRENT REFRESH RACE — two simultaneous refresh calls with the same refresh token: exactly one succeeds, the other is rejected, only one new pair is minted', async () => {
    const issued = await issueToken('concurrent-race');

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/admin/api-tokens/refresh')
        .send({ refreshToken: issued.refreshToken }),
      request(app.getHttpServer())
        .post('/admin/api-tokens/refresh')
        .send({ refreshToken: issued.refreshToken }),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 401]);

    // `parentTokenId: issued.refreshTokenId` alone would also match the
    // ORIGINAL access token from `issueToken()` above (an access token's
    // own parentTokenId is the refresh token that issued it — the same
    // value a rotated NEW refresh token's parentTokenId now also carries,
    // by design, for chain traceability). Filter to `tokenType: 'refresh'`
    // specifically to count only rotation descendants.
    const descendantRefreshRows = await prisma.apiToken.findMany({
      where: { parentTokenId: issued.refreshTokenId, tokenType: 'refresh' },
    });
    expect(descendantRefreshRows).toHaveLength(1);
  }, 30_000);
});
