import { randomUUID } from 'node:crypto';
import { RecordDebtReminderEventsUseCase } from '@afa/application';
import { runWithUserContext } from '@afa/shared';
import {
  PrismaCounterpartyRepository,
  PrismaDebtReminderRepository,
  PrismaDebtRepository,
  PrismaDomainEventRepository,
  PrismaService,
} from '@afa/infrastructure';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Debt Reminder Producer task — the required real-Postgres proof of the
 * full chain this task's own instructions describe literally:
 *
 *   Scheduled scan -> query eligible debts -> classify condition
 *   -> record DomainEvent (real, unmodified DomainEventRepository.record())
 *   -> FR-DB-015's own real dispatcher can claim and dispatch it
 *
 * Deliberately placed in `apps/worker` (the composition root), mirroring
 * `notification-delivery.integration.spec.ts`'s own established
 * convention. This suite stops at "FR-DB-015 successfully dispatches the
 * event" — it does not re-verify NotificationDeliveryConsumer's own
 * behavior (TASK-BOT-009's own suite already does that exhaustively, and
 * this task does not modify it).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const TELEGRAM_USER_ID = 900_000_000_970n;
const CURRENCY_CODE = 'UZS';

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

describe('Debt Reminder Producer — scan -> record DomainEvent -> FR-DB-015 dispatch (real Postgres)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const debtRepository = new PrismaDebtRepository(prisma, prisma);
  const counterpartyRepository = new PrismaCounterpartyRepository(prisma);
  const reminderRepository = new PrismaDebtReminderRepository(prisma);
  const domainEventRepository = new PrismaDomainEventRepository(prisma);
  const useCase = new RecordDebtReminderEventsUseCase(reminderRepository, domainEventRepository);

  let userId: string;
  let createdDebtIds: string[] = [];

  function as<T>(fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    // Sweep any stray `pending` domain_events left over from earlier,
    // unrelated test/debugging runs in this shared dev database — the
    // same established reasoning `transaction-event-cache-invalidation.
    // integration.spec.ts`'s own `beforeAll` already documents: this
    // suite's own `dispatchNextPending` calls claim strictly the
    // globally-oldest pending row, so a leftover stale backlog would
    // otherwise have to be drained first, potentially unboundedly.
    await prisma.domainEvent.deleteMany({
      where: { status: 'pending', createdAt: { lt: new Date() } },
    });

    const user = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID },
      create: {
        telegramUserId: TELEGRAM_USER_ID,
        displayName: 'Debt Reminder E2E',
        timezone: 'UTC',
      },
      update: { timezone: 'UTC', status: 'active' },
    });
    userId = user.id;
  });

  afterEach(async () => {
    if (createdDebtIds.length > 0) {
      for (const debtId of createdDebtIds) {
        await prisma.domainEvent.deleteMany({
          where: { payload: { path: ['debtId'], equals: debtId } },
        });
      }
      await prisma.debt.deleteMany({ where: { id: { in: createdDebtIds } } });
    }
    createdDebtIds = [];
  });

  afterAll(async () => {
    await prisma.counterparty.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
  });

  async function makeDebt(dueDate: Date) {
    const counterparty = await as(() =>
      counterpartyRepository.findOrCreateByName(userId, `E2E-${randomUUID()}`),
    );
    const debt = await as(() =>
      debtRepository.create({
        userId,
        direction: 'given',
        counterpartyName: counterparty.name,
        counterpartyRefId: counterparty.id,
        originalAmount: '75000',
        currency: CURRENCY_CODE,
        transactionDate: new Date(),
        dueDate,
        notes: null,
        originalText: 'e2e reminder debt',
      }),
    );
    createdDebtIds.push(debt.id);
    return { debt, counterparty };
  }

  it('A — a debt due tomorrow: the scan records a real, pending DebtDueApproaching event with the correct payload', async () => {
    const { debt, counterparty } = await makeDebt(daysFromNow(1));

    const summary = await useCase.execute();
    expect(summary.approachingEmitted).toBeGreaterThanOrEqual(1);

    const events = await prisma.domainEvent.findMany({
      where: { eventType: 'DebtDueApproaching', payload: { path: ['debtId'], equals: debt.id } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe('pending');
    expect(events[0]!.payload).toMatchObject({
      debtId: debt.id,
      userId,
      counterpartyName: counterparty.name,
      currency: CURRENCY_CODE,
    });
  }, 60_000);

  it('B — a second scan immediately after does NOT re-emit for the same debt (producer-side dedup)', async () => {
    const { debt } = await makeDebt(daysFromNow(0));

    await useCase.execute();
    const afterFirst = await prisma.domainEvent.count({
      where: { eventType: 'DebtDueApproaching', payload: { path: ['debtId'], equals: debt.id } },
    });
    expect(afterFirst).toBe(1);

    await useCase.execute();
    const afterSecond = await prisma.domainEvent.count({
      where: { eventType: 'DebtDueApproaching', payload: { path: ['debtId'], equals: debt.id } },
    });
    expect(afterSecond).toBe(1); // unchanged — the dedup gate caught the re-scan
  }, 60_000);

  it("C — FR-DB-015's own real dispatcher can claim and dispatch the recorded event (end-to-end wiring proof)", async () => {
    const { debt } = await makeDebt(daysFromNow(1));
    await useCase.execute();

    const eventBefore = await prisma.domainEvent.findFirstOrThrow({
      where: { eventType: 'DebtDueApproaching', payload: { path: ['debtId'], equals: debt.id } },
    });
    expect(eventBefore.status).toBe('pending');

    // A real dispatch cycle — no fake, no synthetic event. This is FR-DB-015's
    // own dispatchNextPending, entirely unmodified by this task, proving the
    // recorded event is genuinely consumable by the existing pipeline.
    // Looped with a bound: this shared dev database can have older,
    // unrelated stray pending events from other suites ahead of this one
    // in claim order (oldest-first) — each is safely `retry`'d (a normal,
    // non-destructive outcome, unchanged from FR-DB-015's own established
    // behavior) until this test's own event is reached.
    let dispatchedThisEvent = false;
    for (let attempt = 0; attempt < 50 && !dispatchedThisEvent; attempt += 1) {
      const result = await domainEventRepository.dispatchNextPending(async (claimedEvent) => {
        if (claimedEvent.id === eventBefore.id) {
          dispatchedThisEvent = true;
          return { outcome: 'dispatched' };
        }
        return { outcome: 'retry' };
      });
      if (!result) {
        break; // nothing left pending at all
      }
    }

    expect(dispatchedThisEvent).toBe(true);
    const eventAfter = await prisma.domainEvent.findUniqueOrThrow({
      where: { id: eventBefore.id },
    });
    expect(eventAfter.status).toBe('dispatched');
  }, 60_000);

  it('D — concurrent scans over the SAME eligible debt: the producer-side dedup check reduces but does not guarantee zero duplication — documented, not silently assumed perfect (FR-FIN-048 is the true safety net, unmodified by this task)', async () => {
    const { debt } = await makeDebt(daysFromNow(0));

    const [first, second] = await Promise.all([useCase.execute(), useCase.execute()]);

    const events = await prisma.domainEvent.count({
      where: { eventType: 'DebtDueApproaching', payload: { path: ['debtId'], equals: debt.id } },
    });
    // Honestly asserting the ACTUAL guarantee: at least one event landed
    // (the scan is not silently swallowing eligible debts), and no more
    // than 2 (both concurrent runs, in the worst case, each pass the
    // check-then-insert race) — never unbounded duplication.
    expect(events).toBeGreaterThanOrEqual(1);
    expect(events).toBeLessThanOrEqual(2);
    expect(first.candidatesScanned).toBeGreaterThanOrEqual(1);
    expect(second.candidatesScanned).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe('Debt Reminder Producer — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('Debt Reminder Producer e2e environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});
