import { BullModule } from '@nestjs/bullmq';
import type { DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * The one BullMQ connection configuration for the whole system. apps/worker
 * consumes this to register processors (Job Queue & Worker Pool, Chapter 3
 * §3.3.3); apps/api and apps/telegram-bot consume it only to enqueue jobs,
 * never to process them ("The Worker must execute queues only").
 *
 * No queue is registered here — naming a specific queue (e.g. an AI
 * extraction queue) presupposes a business workflow that doesn't exist yet.
 * Queues are registered per-consumer via `BullModule.registerQueue(...)`
 * once ENGINEERING-TASK-BREAKDOWN.md's relevant task is implemented.
 */
export class QueueModule {
  static forRoot(): DynamicModule {
    return BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        // BullMQ Workers require maxRetriesPerRequest: null on their Redis
        // connection (documented BullMQ requirement — without it, blocking
        // commands used internally by Workers fail against a connection
        // configured for a bounded number of retries).
        connection: new Redis(config.getOrThrow<string>('REDIS_URL'), {
          maxRetriesPerRequest: null,
        }),
      }),
      inject: [ConfigService],
    });
  }
}
