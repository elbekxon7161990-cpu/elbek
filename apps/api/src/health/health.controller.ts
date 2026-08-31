import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { HealthCheckResult } from '@nestjs/terminus';
import { HealthCheck, HealthCheckError, HealthCheckService } from '@nestjs/terminus';
import { PrismaService, REDIS_CLIENT } from '@afa/infrastructure';
import type { RedisClient } from '@afa/infrastructure';

/**
 * Chapter 17 §17.13.2's three-tier health-check architecture
 * (liveness/readiness/deep). This controller implements the readiness/deep
 * tier — a real dependency check (database, Redis) — not merely "process is
 * running," which a liveness probe alone would only confirm.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([async () => this.checkDatabase(), async () => this.checkRedis()]);
  }

  private async checkDatabase(): Promise<Record<string, { status: 'up' | 'down' }>> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: { status: 'up' } };
    } catch {
      throw new HealthCheckError('Database check failed', {
        database: { status: 'down' },
      });
    }
  }

  private async checkRedis(): Promise<Record<string, { status: 'up' | 'down' }>> {
    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') {
        throw new Error('Unexpected PING response');
      }
      return { redis: { status: 'up' } };
    } catch {
      throw new HealthCheckError('Redis check failed', {
        redis: { status: 'down' },
      });
    }
  }
}
