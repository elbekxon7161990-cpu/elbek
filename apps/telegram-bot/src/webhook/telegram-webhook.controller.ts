import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';
import type { Update } from 'telegraf/types';

import { TelegramBotService } from '../bot/telegram-bot.service';
import { TelegramUpdateDedupService } from './telegram-update-dedup.service';

const SECRET_TOKEN_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * TASK-BOT-001 (Chapter 3 §3.3.1 API Gateway / Webhook Layer — bundled into
 * this task since no separate task owns it): receives Telegram's webhook
 * POST, validates the shared secret, deduplicates redeliveries by
 * `update_id`, and hands a fresh update to `TelegramBotService.handleUpdate`.
 * Always responds 200 for anything past the secret-token check — a 4xx/5xx
 * here would make Telegram retry indefinitely for failures that a retry
 * cannot fix (an internal bug already logged via `bot.catch`), which would
 * only add duplicate-delivery pressure rather than resolve anything.
 */
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    // Explicit @Inject — same reason as TelegramBotService's own
    // constructor (see its doc comment and this app's vitest.config.ts):
    // belt-and-suspenders alongside the systemic SWC vitest transform fix.
    @Inject(ConfigService) private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly telegramBotService: TelegramBotService,
    private readonly dedup: TelegramUpdateDedupService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async receiveWebhook(
    @Headers(SECRET_TOKEN_HEADER) secretToken: string | undefined,
    @Body() update: Update,
  ): Promise<{ ok: true }> {
    const expectedSecret = this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true });
    if (!expectedSecret || secretToken !== expectedSecret) {
      throw new UnauthorizedException('Invalid or missing webhook secret token');
    }

    if (!update || typeof update.update_id !== 'number') {
      throw new BadRequestException('Malformed Telegram update');
    }

    const alreadySeen = await this.dedup.isDuplicate(update.update_id);
    if (alreadySeen) {
      this.logger.log(`Duplicate Telegram update_id=${update.update_id} — skipping reprocessing`);
      return { ok: true };
    }

    try {
      await this.telegramBotService.handleUpdate(update);
    } catch (error) {
      // Already logged by TelegramBotService's own bot.catch() for
      // handler-level failures; this guards the remaining surface (e.g. a
      // throw from handleUpdate itself) so a bug on our side never turns
      // into an indefinite Telegram retry storm.
      this.logger.error(`Unhandled error processing update_id=${update.update_id}`, error as Error);
    }

    return { ok: true };
  }
}
