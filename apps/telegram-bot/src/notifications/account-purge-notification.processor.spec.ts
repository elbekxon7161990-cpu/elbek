import { describe, expect, it, vi } from 'vitest';
import { TelegramDeliveryBlockedError, type TelegramNotificationSender } from '@afa/domain';
import type { Job } from 'bullmq';

import type { AccountPurgeNotificationJobPayload } from '@afa/infrastructure';

import { AccountPurgeNotificationProcessor } from './account-purge-notification.processor';

function fakeJob(
  payload: AccountPurgeNotificationJobPayload,
): Job<AccountPurgeNotificationJobPayload> {
  return { data: payload } as Job<AccountPurgeNotificationJobPayload>;
}

describe('AccountPurgeNotificationProcessor', () => {
  it('sends the final purge-completion message to the given telegram chat id, in the given language', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sender = { send } as unknown as TelegramNotificationSender;
    const processor = new AccountPurgeNotificationProcessor(sender);

    const result = await processor.process(
      fakeJob({ telegramUserId: '123456', preferredLanguage: 'ru' }),
    );

    expect(result).toEqual({ status: 'sent' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('123456', expect.stringContaining('удалены'));
  });

  it('falls back to English for an unrecognized preferredLanguage value', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sender = { send } as unknown as TelegramNotificationSender;
    const processor = new AccountPurgeNotificationProcessor(sender);

    await processor.process(fakeJob({ telegramUserId: '1', preferredLanguage: 'fr' }));

    expect(send).toHaveBeenCalledWith('1', expect.stringContaining('permanently deleted'));
  });

  it('treats a blocked recipient as a terminal no-op, never rethrown (BR-NOT-001)', async () => {
    const send = vi.fn().mockRejectedValue(new TelegramDeliveryBlockedError('1'));
    const sender = { send } as unknown as TelegramNotificationSender;
    const processor = new AccountPurgeNotificationProcessor(sender);

    const result = await processor.process(
      fakeJob({ telegramUserId: '1', preferredLanguage: 'en' }),
    );

    expect(result).toEqual({ status: 'blocked' });
  });

  it('propagates an unexpected send error (letting BullMQ apply its own retry/backoff)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network timeout'));
    const sender = { send } as unknown as TelegramNotificationSender;
    const processor = new AccountPurgeNotificationProcessor(sender);

    await expect(
      processor.process(fakeJob({ telegramUserId: '1', preferredLanguage: 'en' })),
    ).rejects.toThrow('network timeout');
  });
});
