import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';
import type { Update } from 'telegraf/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramWebhookController } from './telegram-webhook.controller';

function makeConfig(secret = 'expected-secret'): ConfigService<EnvironmentVariables, true> {
  return { get: vi.fn().mockReturnValue(secret) } as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
}

function fakeUpdate(updateId: number): Update {
  return { update_id: updateId } as unknown as Update;
}

describe('TelegramWebhookController (TASK-BOT-001 §3.3.1)', () => {
  let telegramBotService: { handleUpdate: ReturnType<typeof vi.fn> };
  let dedup: { isDuplicate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    telegramBotService = { handleUpdate: vi.fn().mockResolvedValue(undefined) };
    dedup = { isDuplicate: vi.fn().mockResolvedValue(false) };
  });

  it('rejects a request with a missing secret token header', async () => {
    const controller = new TelegramWebhookController(
      makeConfig(),
      telegramBotService as any,
      dedup as any,
    );

    await expect(controller.receiveWebhook(undefined, fakeUpdate(1))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(telegramBotService.handleUpdate).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong secret token', async () => {
    const controller = new TelegramWebhookController(
      makeConfig(),
      telegramBotService as any,
      dedup as any,
    );

    await expect(controller.receiveWebhook('wrong-secret', fakeUpdate(1))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when no webhook secret is configured at all (never silently accept)', async () => {
    const controller = new TelegramWebhookController(
      makeConfig(undefined as unknown as string),
      telegramBotService as any,
      dedup as any,
    );

    await expect(controller.receiveWebhook('anything', fakeUpdate(1))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a malformed update (missing update_id)', async () => {
    const controller = new TelegramWebhookController(
      makeConfig(),
      telegramBotService as any,
      dedup as any,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(controller.receiveWebhook('expected-secret', {} as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(telegramBotService.handleUpdate).not.toHaveBeenCalled();
  });

  it('processes a valid, fresh update and delegates to TelegramBotService.handleUpdate', async () => {
    const controller = new TelegramWebhookController(
      makeConfig(),
      telegramBotService as any,
      dedup as any,
    );
    const update = fakeUpdate(42);

    const result = await controller.receiveWebhook('expected-secret', update);

    expect(result).toEqual({ ok: true });
    expect(telegramBotService.handleUpdate).toHaveBeenCalledWith(update);
  });

  it('skips reprocessing a duplicate update_id but still returns ok (never make Telegram retry a dupe forever)', async () => {
    dedup.isDuplicate.mockResolvedValue(true);

    const controller = new TelegramWebhookController(
      makeConfig(),
      telegramBotService as any,
      dedup as any,
    );

    const result = await controller.receiveWebhook('expected-secret', fakeUpdate(42));

    expect(result).toEqual({ ok: true });
    expect(telegramBotService.handleUpdate).not.toHaveBeenCalled();
  });

  it('swallows a downstream handleUpdate failure and still returns ok (never trigger an indefinite Telegram retry storm for our own bug)', async () => {
    telegramBotService.handleUpdate.mockRejectedValue(new Error('boom'));

    const controller = new TelegramWebhookController(
      makeConfig(),
      telegramBotService as any,
      dedup as any,
    );

    const result = await controller.receiveWebhook('expected-secret', fakeUpdate(42));

    expect(result).toEqual({ ok: true });
  });
});
