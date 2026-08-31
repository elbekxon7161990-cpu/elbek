import { describe, expect, it, vi } from 'vitest';
import type { RolloverBudgetPeriodsSummary, RolloverBudgetPeriodsUseCase } from '@afa/application';

import { BudgetRolloverProcessor } from './budget-rollover.processor';

function fakeUseCase(summary: RolloverBudgetPeriodsSummary): RolloverBudgetPeriodsUseCase {
  return {
    execute: vi.fn().mockResolvedValue(summary),
  } as unknown as RolloverBudgetPeriodsUseCase;
}

describe('BudgetRolloverProcessor', () => {
  it('delegates to RolloverBudgetPeriodsUseCase.execute() and returns the aggregate counts', async () => {
    const useCase = fakeUseCase({ candidatesScanned: 3, rolledOver: 2, skippedAsRace: 1 });
    const processor = new BudgetRolloverProcessor(useCase);

    const result = await processor.process();

    expect(useCase.execute).toHaveBeenCalled();
    expect(result).toEqual({ candidatesScanned: 3, rolledOver: 2 });
  });

  it('never includes budget-level detail (limit amounts, category names) in its log line (Chapter 16 §16.3 data minimization)', async () => {
    const useCase = fakeUseCase({ candidatesScanned: 1, rolledOver: 1, skippedAsRace: 0 });
    const processor = new BudgetRolloverProcessor(useCase);
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);

    await processor.process();

    expect(logSpy).toHaveBeenCalled();
    const loggedText = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(loggedText).not.toMatch(/category|amount|limit/i);
  });

  it('propagates an unexpected error from the use case (letting BullMQ apply its own outer handling)', async () => {
    const useCase = {
      execute: vi.fn().mockRejectedValue(new Error('db unavailable')),
    } as unknown as RolloverBudgetPeriodsUseCase;
    const processor = new BudgetRolloverProcessor(useCase);

    await expect(processor.process()).rejects.toThrow('db unavailable');
  });
});
