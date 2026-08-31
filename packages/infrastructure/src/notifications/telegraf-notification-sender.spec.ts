import { TelegramDeliveryBlockedError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSendMessage, MockTelegramError } = vi.hoisted(() => {
  class TelegramErrorMock extends Error {
    response: { error_code: number; description: string };
    constructor(errorCode: number, description: string) {
      super(description);
      this.response = { error_code: errorCode, description };
    }
  }
  return {
    mockSendMessage: vi.fn(),
    MockTelegramError: TelegramErrorMock,
  };
});

vi.mock('telegraf', () => ({
  Telegram: vi.fn().mockImplementation(() => ({ sendMessage: mockSendMessage })),
  TelegramError: MockTelegramError,
}));

import { TelegrafNotificationSender } from './telegraf-notification-sender';

describe('TelegrafNotificationSender', () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
  });

  it('sends the message via the Telegram API client', async () => {
    mockSendMessage.mockResolvedValue({});
    const sender = new TelegrafNotificationSender('fake-token');

    await sender.send('12345', 'hello');

    expect(mockSendMessage).toHaveBeenCalledWith('12345', 'hello', undefined);
  });

  it('TASK-AI-006 — passes an inline keyboard through as reply_markup when a replyMarkup is given', async () => {
    mockSendMessage.mockResolvedValue({});
    const sender = new TelegrafNotificationSender('fake-token');
    const keyboard = [[{ text: '✅ Confirm', callback_data: 'ocrdraft_confirm:draft-1' }]];

    await sender.send('12345', 'hello', keyboard);

    expect(mockSendMessage).toHaveBeenCalledWith('12345', 'hello', {
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  it('throws TelegramDeliveryBlockedError specifically on a 403 (bot blocked) response', async () => {
    mockSendMessage.mockRejectedValue(
      new MockTelegramError(403, 'Forbidden: bot was blocked by the user'),
    );
    const sender = new TelegrafNotificationSender('fake-token');

    await expect(sender.send('12345', 'hello')).rejects.toThrow(TelegramDeliveryBlockedError);
  });

  it('rethrows any other Telegram error unchanged (never silently swallowed)', async () => {
    mockSendMessage.mockRejectedValue(new MockTelegramError(429, 'Too Many Requests'));
    const sender = new TelegrafNotificationSender('fake-token');

    await expect(sender.send('12345', 'hello')).rejects.not.toBeInstanceOf(
      TelegramDeliveryBlockedError,
    );
  });

  it('rethrows a non-Telegram error unchanged', async () => {
    mockSendMessage.mockRejectedValue(new Error('network timeout'));
    const sender = new TelegrafNotificationSender('fake-token');

    await expect(sender.send('12345', 'hello')).rejects.toThrow('network timeout');
  });
});
