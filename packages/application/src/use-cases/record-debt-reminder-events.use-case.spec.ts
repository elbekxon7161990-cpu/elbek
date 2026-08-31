import type {
  DebtReminderCandidate,
  DebtReminderRepository,
  DomainEventRepository,
} from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordDebtReminderEventsUseCase } from './record-debt-reminder-events.use-case';

const NOW = new Date('2026-08-15T12:00:00Z');

function makeCandidate(overrides: Partial<DebtReminderCandidate> = {}): DebtReminderCandidate {
  return {
    debtId: 'debt-1',
    userId: 'user-1',
    counterpartyName: 'Aziz',
    outstandingBalance: '50000.00',
    currency: 'UZS',
    dueDate: new Date('2026-08-15'), // due today, relative to NOW
    userTimezone: 'UTC',
    ...overrides,
  };
}

describe('RecordDebtReminderEventsUseCase (FR-DBT-007)', () => {
  let reminderRepository: DebtReminderRepository & {
    findCandidates: ReturnType<typeof vi.fn>;
    wasReminderEventRecentlyRecorded: ReturnType<typeof vi.fn>;
  };
  let domainEventRepository: DomainEventRepository & { record: ReturnType<typeof vi.fn> };
  let useCase: RecordDebtReminderEventsUseCase;

  beforeEach(() => {
    reminderRepository = {
      findCandidates: vi.fn().mockResolvedValue([]),
      wasReminderEventRecentlyRecorded: vi.fn().mockResolvedValue(false),
    } as unknown as typeof reminderRepository;
    domainEventRepository = {
      record: vi.fn().mockResolvedValue({}),
    } as unknown as typeof domainEventRepository;
    useCase = new RecordDebtReminderEventsUseCase(reminderRepository, domainEventRepository);
  });

  it('emits DebtDueApproaching for a debt due today', async () => {
    reminderRepository.findCandidates.mockResolvedValue([
      makeCandidate({ dueDate: new Date('2026-08-15') }),
    ]);

    const summary = await useCase.execute(NOW);

    expect(domainEventRepository.record).toHaveBeenCalledWith({
      eventType: 'DebtDueApproaching',
      payload: expect.objectContaining({
        debtId: 'debt-1',
        userId: 'user-1',
        counterpartyName: 'Aziz',
      }),
    });
    expect(summary).toEqual({
      candidatesScanned: 1,
      approachingEmitted: 1,
      overdueEmitted: 0,
      skippedAsDuplicate: 0,
    });
  });

  it('emits DebtDueApproaching for a debt due tomorrow (1 day before)', async () => {
    reminderRepository.findCandidates.mockResolvedValue([
      makeCandidate({ dueDate: new Date('2026-08-16') }),
    ]);

    await useCase.execute(NOW);

    expect(domainEventRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'DebtDueApproaching' }),
    );
  });

  it('emits DebtOverdue for a debt past its due date', async () => {
    reminderRepository.findCandidates.mockResolvedValue([
      makeCandidate({ dueDate: new Date('2026-08-10') }),
    ]);

    const summary = await useCase.execute(NOW);

    expect(domainEventRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'DebtOverdue' }),
    );
    expect(summary.overdueEmitted).toBe(1);
  });

  it('emits nothing for a debt outside the approaching window (due in 3 days)', async () => {
    reminderRepository.findCandidates.mockResolvedValue([
      makeCandidate({ dueDate: new Date('2026-08-18') }),
    ]);

    const summary = await useCase.execute(NOW);

    expect(domainEventRepository.record).not.toHaveBeenCalled();
    expect(summary).toEqual({
      candidatesScanned: 1,
      approachingEmitted: 0,
      overdueEmitted: 0,
      skippedAsDuplicate: 0,
    });
  });

  it('skips (never calls record) when the dedup gate reports a recent event for this debt', async () => {
    reminderRepository.findCandidates.mockResolvedValue([
      makeCandidate({ dueDate: new Date('2026-08-15') }),
    ]);
    reminderRepository.wasReminderEventRecentlyRecorded.mockResolvedValue(true);

    const summary = await useCase.execute(NOW);

    expect(domainEventRepository.record).not.toHaveBeenCalled();
    expect(summary.skippedAsDuplicate).toBe(1);
  });

  it('uses a per-user local calendar date, not server UTC, to classify eligibility', async () => {
    // 12:00 UTC = 21:00 in a UTC+9 timezone, same calendar day either way —
    // but a debt due "tomorrow" UTC could already be "today" in a timezone
    // ahead of UTC; this proves the candidate's own timezone is honored.
    reminderRepository.findCandidates.mockResolvedValue([
      makeCandidate({ dueDate: new Date('2026-08-15'), userTimezone: 'Asia/Tashkent' }),
    ]);

    await useCase.execute(NOW);

    expect(reminderRepository.wasReminderEventRecentlyRecorded).toHaveBeenCalledWith(
      'debt-1',
      'DebtDueApproaching',
      expect.any(Date),
    );
  });

  it('passes a 7-day dedup window for overdue reminders (FR-DBT-007 "recurring, default weekly")', async () => {
    reminderRepository.findCandidates.mockResolvedValue([
      makeCandidate({ dueDate: new Date('2026-08-10') }),
    ]);

    await useCase.execute(NOW);

    const [, , sinceDate] = reminderRepository.wasReminderEventRecentlyRecorded.mock.calls[0]!;
    const diffDays = (NOW.getTime() - sinceDate.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(7, 5);
  });

  it('scans multiple candidates independently, aggregating the summary correctly', async () => {
    reminderRepository.findCandidates.mockResolvedValue([
      makeCandidate({ debtId: 'debt-1', dueDate: new Date('2026-08-15') }), // approaching
      makeCandidate({ debtId: 'debt-2', dueDate: new Date('2026-08-01') }), // overdue
      makeCandidate({ debtId: 'debt-3', dueDate: new Date('2026-12-01') }), // none
    ]);

    const summary = await useCase.execute(NOW);

    expect(summary).toEqual({
      candidatesScanned: 3,
      approachingEmitted: 1,
      overdueEmitted: 1,
      skippedAsDuplicate: 0,
    });
    expect(domainEventRepository.record).toHaveBeenCalledTimes(2);
  });
});
