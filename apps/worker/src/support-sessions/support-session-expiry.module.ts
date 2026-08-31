import { Module } from '@nestjs/common';
import { ExpireSupportSessionsModule } from '@afa/application';
import {
  SupportSessionExpiryQueueModule,
  SupportSessionRepositoryModule,
} from '@afa/infrastructure';

import { SupportSessionExpiryProcessor } from './support-session-expiry.processor';
import { SupportSessionExpiryScheduler } from './support-session-expiry.scheduler';

/** TASK-SEC-006 — composition-root wiring, mirroring `AccountPurgeModule`'s own shape. */
@Module({
  imports: [
    ExpireSupportSessionsModule,
    SupportSessionRepositoryModule,
    SupportSessionExpiryQueueModule,
  ],
  providers: [SupportSessionExpiryProcessor, SupportSessionExpiryScheduler],
})
export class SupportSessionExpiryModule {}
