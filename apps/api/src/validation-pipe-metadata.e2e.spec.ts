import 'reflect-metadata';
import { Body, Controller, INestApplication, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createValidationPipe } from '@afa/shared';

/**
 * Regression test for the vitest decorator-metadata gap found during
 * TASK-SEC-006 verification: `Reflect.getMetadata('design:paramtypes', ...)`
 * was `undefined` under vitest's default esbuild transform, so NestJS's
 * `ValidationPipe` could never resolve a `@Body()` DTO's metatype and
 * silently skipped validation. `apps/api/vitest.config.ts` now transforms
 * TypeScript via `unplugin-swc` (with `decoratorMetadata: true`) instead of
 * esbuild specifically to fix this. This test is deliberately generic —
 * its own throwaway DTO, not SEC-006's — so it proves the FIX itself
 * (real class-validator enforcement through the real ValidationPipe under
 * vitest), independent of any one feature's DTOs.
 */
class ProbeDto {
  @IsString()
  @MinLength(1)
  value!: string;
}

@Controller('probe')
class ProbeController {
  @Post()
  submit(@Body() dto: ProbeDto): { value: string } {
    return { value: dto.value };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('ValidationPipe DTO metatype resolution under vitest (regression)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves design:paramtypes metadata for a @Body() DTO parameter', () => {
    const paramTypes = Reflect.getMetadata(
      'design:paramtypes',
      ProbeController.prototype,
      'submit',
    ) as unknown[] | undefined;
    expect(paramTypes?.[0]).toBe(ProbeDto);
  });

  it('rejects a class-validator-invalid body with 400 through the real ValidationPipe', async () => {
    await request(app.getHttpServer()).post('/probe').send({ value: '' }).expect(400);
  });

  it('accepts a class-validator-valid body and reaches the controller', async () => {
    const res = await request(app.getHttpServer()).post('/probe').send({ value: 'ok' }).expect(201);
    expect(res.body.value).toBe('ok');
  });
});
