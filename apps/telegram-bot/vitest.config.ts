import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * URGENT follow-up (TASK-AI-006 real-boot fix) — same TASK-SEC-006 finding
 * apps/api's own vitest.config.ts already documents: vitest's default
 * esbuild transform cannot reliably emit `design:paramtypes` decorator
 * metadata (esbuild does no type analysis). Discovered here via
 * TelegramBotService's real, full AppModule compile failing under vitest —
 * first ConfigService (a generic type parameterized by a type-only import),
 * then ProvisionTelegramUserUseCase (a plain class) at the very next
 * constructor position once the first was pinned with an explicit
 * `@Inject` — proving the gap is not confined to one parameter shape, so a
 * single localized `@Inject` cannot be the systemic fix. The real `tsc -b`
 * production build already emits this metadata correctly (independently
 * verified by compiling apps/telegram-bot's own dist/ output directly with
 * plain node, outside vitest entirely) — this is a test-harness-only gap.
 * SWC's transform, unlike esbuild's, emits it correctly; config mirrors
 * tsconfig.base.json's own `experimentalDecorators`/`emitDecoratorMetadata`
 * settings so behavior under test matches the real build.
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
