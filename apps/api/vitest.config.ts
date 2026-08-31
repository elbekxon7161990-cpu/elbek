import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * TASK-SEC-006 verification finding: vitest's default esbuild transform
 * cannot emit `design:paramtypes` decorator metadata (esbuild does no
 * type analysis). NestJS's `ValidationPipe` relies on that metadata to
 * resolve a `@Body()` parameter's DTO class; without it, `metatype`
 * resolves to nothing and validation is silently skipped for every
 * class-validator-decorated DTO under vitest — while the real `tsc -b`
 * production build (which does emit this metadata) is unaffected. SWC's
 * transform, unlike esbuild's, can emit it — this is the standard fix
 * for this exact NestJS+Vitest gap. Config here mirrors tsconfig.base.json's
 * own `experimentalDecorators`/`emitDecoratorMetadata` settings so behavior
 * under test matches the real build.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
  },
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        keepClassNames: true,
      },
      module: {
        type: 'es6',
      },
    }),
  ],
});
