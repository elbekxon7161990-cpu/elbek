import type { OnModuleDestroy } from '@nestjs/common';
import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { REDIS_CLIENT } from './redis.constants';

@Injectable()
class RedisLifecycleLogger implements OnModuleDestroy {
  private readonly logger = new Logger('RedisClient');

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {
    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('error', (error) => this.logger.error('Redis connection error', error.stack));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

/**
 * The one Redis connection shared by every consumer that needs raw Redis
 * access (BullMQ uses its own connection, wired separately in
 * ../queue/queue.module.ts, since @nestjs/bullmq manages that lifecycle
 * itself) — this module is for direct Redis use outside the queue system
 * (e.g. a future cache-invalidation consumer, Chapter 13 §13.38).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const url = config.getOrThrow<string>('REDIS_URL');
        return new Redis(url, { maxRetriesPerRequest: 3 });
      },
      inject: [ConfigService],
    },
    RedisLifecycleLogger,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
