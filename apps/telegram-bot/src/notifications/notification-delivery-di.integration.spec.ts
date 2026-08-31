import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TELEGRAM_NOTIFICATION_SENDER } from '@afa/domain';
import { QueueModule } from '@afa/infrastructure';

import { AccountPurgeNotificationProcessor } from './account-purge-notification.processor';
import { NotificationDeliveryModule } from './notification-delivery.module';
import { NotificationDeliveryProcessor } from './notification-delivery.processor';

/**
 * TASK-AUTH-006 — real NestJS DI resolution proof, mirroring
 * `account-deletion-di.integration.spec.ts`'s own approach: this task added
 * `AccountPurgeNotificationProcessor` (and `AccountPurgeNotificationQueueModule`)
 * into the ALREADY-`@Global()` `NotificationDeliveryModule` — a real
 * `.compile()` of that exact module is what actually verifies the addition
 * didn't break `NotificationDeliveryProcessor`'s own existing resolution,
 * not a mocked-provider unit test.
 *
 * `.compile()` alone (no `.init()`) proves provider RESOLUTION, not a live
 * Postgres/Redis connection.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';

describe('NotificationDeliveryModule DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves NotificationDeliveryProcessor and AccountPurgeNotificationProcessor with TELEGRAM_NOTIFICATION_SENDER live, using the real production modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        QueueModule.forRoot(),
        NotificationDeliveryModule,
      ],
    }).compile();

    expect(moduleRef.get(NotificationDeliveryProcessor)).toBeInstanceOf(
      NotificationDeliveryProcessor,
    );
    expect(moduleRef.get(AccountPurgeNotificationProcessor)).toBeInstanceOf(
      AccountPurgeNotificationProcessor,
    );
    expect(moduleRef.get(TELEGRAM_NOTIFICATION_SENDER)).toBeDefined();

    await moduleRef.close();
  }, 30_000);
});
