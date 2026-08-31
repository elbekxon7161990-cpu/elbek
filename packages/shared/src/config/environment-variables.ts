import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
}

/**
 * Universal environment shape every bootstrap app (api, telegram-bot, worker)
 * validates on startup via ConfigModule's `validate` hook (AppConfigModule,
 * ../config/app-config.module.ts). App-specific variables (e.g.
 * TELEGRAM_BOT_TOKEN) are declared here too, as optional, rather than
 * forking a second validation class per app — every app still gets the same
 * fail-fast startup behavior even for variables it doesn't itself read.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsEnum(LogLevel)
  @IsOptional()
  LOG_LEVEL: LogLevel = LogLevel.Info;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @IsString()
  TELEGRAM_BOT_TOKEN?: string;

  @IsOptional()
  @IsString()
  TELEGRAM_WEBHOOK_SECRET?: string;

  /**
   * TASK-BOT-001 — the public HTTPS URL Telegram should POST updates to
   * (registered via `setWebhook` at boot). Chapter 17 §17.2: "long-polling
   * supported only for local development, never in production" — when this
   * (and `TELEGRAM_WEBHOOK_SECRET`) is unset, `TelegramBotService` falls
   * back to long-polling, matching that same local-dev-only framing.
   */
  @IsOptional()
  @IsString()
  TELEGRAM_WEBHOOK_URL?: string;

  @IsOptional()
  @IsString()
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  OTEL_SERVICE_NAME?: string;

  /**
   * TASK-INFRA-AI-REAL-001 — the real `LlmProvider` adapter's credentials
   * (`AnthropicLlmProvider`, bound by `@afa/infrastructure`'s
   * `LlmProviderModule`). Deliberately optional at the validation-class
   * level (this class is shared by every app, most of which never touch
   * `LLM_PROVIDER` at all) — `LlmProviderModule`'s own factory is what
   * enforces "missing key = fail loud" for the one app that does.
   */
  @IsOptional()
  @IsString()
  ANTHROPIC_API_KEY?: string;

  /** Default extraction model (e.g. `claude-sonnet-5`) — never hardcoded in the adapter itself. */
  @IsOptional()
  @IsString()
  ANTHROPIC_MODEL?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsNumber()
  ANTHROPIC_TEMPERATURE?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  ANTHROPIC_MAX_OUTPUT_TOKENS?: number;

  /**
   * Explicit, dev-only opt-in to bind a fake `LlmProvider` when
   * `ANTHROPIC_API_KEY` is absent — without this flag, `LlmProviderModule`
   * fails startup instead of silently running a fake AI provider.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === '1' || value === true)
  @IsBoolean()
  ALLOW_FAKE_LLM_PROVIDER?: boolean;

  /**
   * TASK-AI-006 — the real `AnthropicVisionOcrProvider` adapter's model
   * override. Falls back to `ANTHROPIC_MODEL` (the same model the
   * text-extraction LLM path already uses) when unset — a separate
   * variable exists only for the case where a different Claude model tier
   * makes sense for vision specifically, not because a second credential
   * or account is required.
   */
  @IsOptional()
  @IsString()
  OCR_ANTHROPIC_MODEL?: string;

  /**
   * Explicit, dev-only opt-in to bind a fake `OcrProvider` when
   * `ANTHROPIC_API_KEY` is absent — mirrors `ALLOW_FAKE_LLM_PROVIDER`'s
   * established convention exactly. Without this flag, `OcrProviderModule`
   * fails startup instead of silently running a fake OCR provider.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === '1' || value === true)
  @IsBoolean()
  ALLOW_FAKE_OCR_PROVIDER?: boolean;

  /**
   * TASK-FIN-007 Stage F — explicit, dev-only opt-in to bind a fake
   * `FxRateProvider`. Unlike `ALLOW_FAKE_LLM_PROVIDER`, there is no "real
   * key present" branch to prefer instead — no real FX vendor is
   * implemented yet (the PRD names none), so `FxRateProviderModule` always
   * either binds this fake or fails startup.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === '1' || value === true)
  @IsBoolean()
  ALLOW_FAKE_FX_RATE_PROVIDER?: boolean;

  /**
   * TASK-FIN-REAL-001 — explicit, dev-only opt-in to bind a fake
   * `TransactionCommitPort` instead of the real, Prisma-backed
   * `TransactionCommitAdapter`. Unlike `ALLOW_FAKE_LLM_PROVIDER`, this is
   * never a *fail-fast* trigger — `DATABASE_URL` is already a mandatory,
   * always-validated variable (`AppConfigModule`), so there is no
   * "database configuration missing" state the real adapter could be
   * bound into; this flag exists purely so a developer can explicitly
   * choose not to write to a real database (e.g. local testing without a
   * disposable dev DB) without silently defaulting to that behavior.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === '1' || value === true)
  @IsBoolean()
  ALLOW_FAKE_TRANSACTION_COMMIT?: boolean;

  /**
   * FR-DB-015 — how often `apps/worker` fires one domain-event polling
   * cycle. Default 1000ms is grounded in `NFR-FIN-003`'s "domain-event
   * emission-to-consumption latency < 2s p95" — see this task's own
   * architecture-decision report for the full reasoning.
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(100)
  DOMAIN_EVENT_POLL_INTERVAL_MS: number = 1000;

  /** FR-DB-015 — max events claimed per polling cycle. A judgment call (not PRD-grounded); see the architecture-decision report. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  DOMAIN_EVENT_BATCH_SIZE: number = 50;

  /** FR-DB-015 — dispatch attempts before an event is marked terminally `failed`. A judgment call (not PRD-grounded); see the architecture-decision report. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  DOMAIN_EVENT_MAX_DISPATCH_ATTEMPTS: number = 5;

  /**
   * Debt Reminder Producer task (FR-DBT-007) — how often the debt-reminder
   * eligibility scan runs. FR-DBT-007 itself specifies the reminder
   * THRESHOLDS (1 day before/on the due date; weekly for overdue), not how
   * often the system checks for them — this interval is a disclosed
   * judgment call, not a PRD-mandated number. Default 24h (daily) is the
   * coarsest interval that still correctly implements FR-DBT-007's own
   * literal day-level thresholds without ever missing a day.
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(60_000)
  DEBT_REMINDER_SCAN_INTERVAL_MS: number = 24 * 60 * 60 * 1000;

  /**
   * TASK-AUTH-002 — symmetric key (32 raw bytes, base64-encoded) used by
   * `LocalEnvelopeSecretStore` to encrypt admin MFA TOTP secrets at rest.
   * FR-SCR-M-001 calls for a dedicated secrets manager; none is configured
   * anywhere in this deployment (audited — see that adapter's own doc
   * comment), so this interim key-based encryption exists so the raw TOTP
   * seed is never itself persisted, pending a real secrets-manager adapter.
   * Optional at the validation-class level for the same reason
   * `ANTHROPIC_API_KEY` is — most apps never read it; `SecretStoreModule`'s
   * own factory enforces fail-loud when apps/api actually needs it and it's
   * absent.
   */
  @IsOptional()
  @IsString()
  MFA_SECRET_ENCRYPTION_KEY?: string;

  /**
   * TASK-AI-006 (Object Storage groundwork) — the real `SupabaseObjectStorage`
   * adapter's project URL (`ObjectStorageModule`'s own factory,
   * `@afa/infrastructure`). Deliberately a SEPARATE credential set from
   * `DATABASE_URL`/`DIRECT_URL` (this project's Supabase Postgres
   * connection-pooler strings) — Storage authenticates via Supabase's REST
   * API + a service-role key, not the Postgres connection string; conflating
   * the two would make it impossible to rotate one without touching the
   * other. Optional at this shared validation-class level (most apps never
   * read it) — `ObjectStorageModule`'s own factory enforces fail-loud when
   * an app that actually needs it is missing configuration.
   */
  @IsOptional()
  @IsString()
  SUPABASE_STORAGE_URL?: string;

  /**
   * Server-only secret — a Supabase service-role key bypasses Row Level
   * Security and must never reach client-side code, logs, or an exception
   * message. `SupabaseObjectStorage`/`ObjectStorageModule` never log or
   * throw this value.
   */
  @IsOptional()
  @IsString()
  SUPABASE_STORAGE_SERVICE_ROLE_KEY?: string;

  @IsOptional()
  @IsString()
  SUPABASE_STORAGE_BUCKET?: string;

  /**
   * Explicit, dev-only opt-in to bind a fake `ObjectStoragePort` when the
   * three `SUPABASE_STORAGE_*` variables above are not fully set — without
   * this flag, `ObjectStorageModule` fails startup instead of silently
   * running an in-memory, process-local fake. Mirrors
   * `ALLOW_FAKE_LLM_PROVIDER`'s established convention exactly.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === '1' || value === true)
  @IsBoolean()
  ALLOW_FAKE_OBJECT_STORAGE?: boolean;
}
