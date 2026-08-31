import { Global, Module } from '@nestjs/common';
import { DOMAIN_EVENT_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaDomainEventRepository } from './prisma-domain-event.repository';

/**
 * Binds @afa/domain's DOMAIN_EVENT_REPOSITORY port to the Prisma
 * implementation. `@Global()` — see user-repository.module.ts's TASK-MVP-002
 * comment for why a sibling import under a shared parent module is not
 * sufficient. No production consumer injects this token yet (see
 * `PrismaDomainEventRepository`'s own doc comment) — provided now for
 * consistency with every other persisted concept in this codebase, and
 * ready for a future dispatch worker (FR-DB-015) to consume.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: DOMAIN_EVENT_REPOSITORY, useClass: PrismaDomainEventRepository }],
  exports: [DOMAIN_EVENT_REPOSITORY],
})
export class DomainEventRepositoryModule {}
