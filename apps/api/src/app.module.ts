import { Module } from '@nestjs/common';
import { AppConfigModule, AppLoggerModule } from '@afa/shared';
import { PrismaModule, RedisModule } from '@afa/infrastructure';

import { AdminAuthHttpModule } from './admin-auth/admin-auth-http.module';
import { AdminStatsHttpModule } from './admin-stats/admin-stats-http.module';
import { AdminUsersHttpModule } from './admin-users/admin-users-http.module';
import { ApiTokenHttpModule } from './api-tokens/api-token-http.module';
import { HealthModule } from './health/health.module';
import { AdminElevationHttpModule } from './rbac/admin-elevation-http.module';
import { SupportSessionHttpModule } from './support-sessions/support-session-http.module';

/**
 * Loads only what apps/api requires: config, logging, the two dependency
 * checks health exposes, and @afa/application's REST-facing modules
 * (TASK-AUTH-002's `AdminAuthHttpModule`, TASK-AUTH-003's
 * `ApiTokenHttpModule`, TASK-AUTH-005's `AdminElevationHttpModule`,
 * TASK-SEC-006's `SupportSessionHttpModule`, and the web admin panel's own
 * `AdminUsersHttpModule`/`AdminStatsHttpModule`). No BullMQ producer/
 * consumer module is imported here yet — nothing in this skeleton enqueues
 * a job — and no Telegraf/bot module is imported at all, per "each
 * bootstrap loads only the modules it requires."
 */
@Module({
  imports: [
    AppConfigModule.forRoot(),
    AppLoggerModule.forRoot('afa-api'),
    PrismaModule,
    RedisModule,
    HealthModule,
    AdminAuthHttpModule,
    ApiTokenHttpModule,
    AdminElevationHttpModule,
    SupportSessionHttpModule,
    AdminUsersHttpModule,
    AdminStatsHttpModule,
  ],
})
export class AppModule {}
