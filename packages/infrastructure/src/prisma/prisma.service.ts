import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The single Prisma client for the whole system (One Database, One Prisma
 * Schema — packages/infrastructure/prisma/schema.prisma, Chapter 13).
 * Repository implementations (added from Phase 4 onward) inject this
 * service; nothing outside packages/infrastructure imports @prisma/client
 * directly (FR-DB-026's repository-pattern requirement).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma client disconnected');
  }
}
