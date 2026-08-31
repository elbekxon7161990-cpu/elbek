import { Global, Module } from '@nestjs/common';
import { API_TOKEN_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaApiTokenRepository } from './prisma-api-token.repository';

/** TASK-AUTH-003 — binds API_TOKEN_REPOSITORY. `@Global()`, same precedent as `AdminRepositoryModule`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [{ provide: API_TOKEN_REPOSITORY, useClass: PrismaApiTokenRepository }],
  exports: [API_TOKEN_REPOSITORY],
})
export class ApiTokenRepositoryModule {}
