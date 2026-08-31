import type { Prisma } from '@prisma/client';
import { detectNewlyCrossedGoalMilestones, GoalProgressUnavailableError } from '@afa/domain';

import { computeSavingsGoalProgress } from './compute-savings-goal-progress';
import { formatDecimalAmount } from './format-decimal-amount';

export interface ContributionCommitGoalContext {
  goalId: string;
}

/**
 * TASK-FIN-004 (Stage E, FR-FIN-013/014, §8.14.5) — the synchronous half of
 * savings-goal milestone/completion detection, called from INSIDE
 * `PrismaTransactionRepository.create()`'s own `basePrisma.$transaction`
 * block, AFTER the new `GOAL_CONTRIBUTION`/goal-linked-`TRANSFER` row itself
 * has been inserted (so `computeSavingsGoalProgress`'s own aggregate query
 * already includes it) but BEFORE that transaction commits — mirroring
 * `evaluateBudgetThresholdsOnExpenseCommit`'s own established "cross-cutting
 * hook triggered by a Transaction write, same-transaction atomicity"
 * pattern (TASK-FIN-003).
 *
 * One deliberate difference from that Budget precedent, disclosed here: no
 * separate dedup-log table is used. `SavingsGoal.lastMilestoneFired`
 * (§13.21.2) already IS the persisted dedup marker for this aggregate, so
 * a single atomic conditional `UPDATE ... WHERE lastMilestoneFired IS NULL
 * OR lastMilestoneFired < :new` (the same "WHERE <still-valid-prior-state>"
 * convention `TASK-BOT-007-FIX`'s conditional soft-delete already
 * established) is both the mutation AND the race-safe dedup gate — Postgres's
 * own row-level locking serializes concurrent commits against the same
 * goal the same way it already does for `Debt.outstandingBalance`.
 *
 * A second deliberate difference, also disclosed: this function does NOT
 * invoke `SavingsGoal.evaluateCompletion` (the Stage A domain method) — it
 * re-expresses the identical FR-FIN-014 rule directly in the SQL mutation
 * instead. This mirrors the exact precedent `PrismaDebtRepository.logRepayment()`'s
 * own SQL already sets: `Debt.applyRepayment` exists for the
 * validate-before-persist / UX pre-check role, while the actual atomic
 * database write independently re-encodes the same rule — the entity method
 * only operates on a full in-memory entity a synchronous SQL-only hook has
 * no reason to reconstruct.
 *
 * TASK-FIN-004 (FR-FIN-013/014 event-producer correction): `updateMany`'s
 * own `count` result is not sufficient to decide WHICH thresholds this
 * commit is responsible for emitting an event for — two genuinely
 * concurrent commits can both legitimately observe a matched row in
 * sequence (transaction A's UPDATE commits first; transaction B was
 * blocked on the row lock, then unblocks and its UPDATE ALSO matches), and
 * B's OWN `crossedThresholds`, computed from whatever `lastMilestoneFired`
 * B read before A committed, would double-count whatever A already fired.
 *
 * A first attempt at fixing this used a `WITH previous AS (SELECT ...)
 * UPDATE ... FROM previous ... RETURNING previous.last_milestone_fired` —
 * this was WRONG and is NOT what ships: Postgres does not re-evaluate a
 * plain (non-target-table) CTE after a lock wait/EvalPlanQual retry, so
 * `previous.last_milestone_fired` can still be stale under genuine
 * concurrency — confirmed empirically (not just theoretically) by this very
 * test suite's own concurrency test failing with the wrong final value
 * during development. Silently shipping that version would have violated
 * this stage's own explicit "do not hide a duplicate/lost-event risk"
 * instruction.
 *
 * What ships instead: `SELECT ... FOR NO KEY UPDATE` to take a row lock
 * BEFORE reading `last_milestone_fired`/`status` (see that statement's own
 * doc comment below for why `FOR NO KEY UPDATE`, not the stronger
 * `FOR UPDATE`). Unlike a CTE, a locked read is guaranteed by Postgres to
 * block until any concurrent holder commits/rolls back and then reflects
 * the LATEST COMMITTED value — never a stale MVCC snapshot.
 *
 * SECOND, DISTINCT CORRECTION (found via a dedicated concurrency
 * investigation after the `FOR NO KEY UPDATE` fix above still left `K`/`T`
 * — this file's own two-concurrent-contribution integration tests —
 * intermittently failing in a full-suite run): the lock alone was not
 * sufficient. `progressPercent` (the `computeSavingsGoalProgress` SUM) was
 * still being computed BEFORE the lock was acquired, using an unprotected
 * READ COMMITTED snapshot that — under genuine concurrency — can see only
 * THIS transaction's own not-yet-committed contribution, never a sibling
 * transaction's simultaneously-committing one. Two concurrent commits could
 * each independently compute the SAME understated `progressPercent` (e.g.
 * both see 30% instead of the true combined 60%), and the second one to
 * acquire the lock would then compare that STALE percent against the FRESH
 * (lock-protected) `last_milestone_fired` — silently losing whichever
 * threshold only the COMBINED total would have crossed. Confirmed via exact
 * code-path tracing matching the observed failure 1:1 (final
 * `lastMilestoneFired` short by exactly one threshold), not merely
 * theorized.
 *
 * The fix: `computeSavingsGoalProgress` is called a SECOND time, AFTER the
 * lock is held (see below) — this second call is the ONLY one whose result
 * is ever compared against `trueCurrentMilestone` or used in an emitted
 * event's payload. Once inside the lock, no concurrent transaction can be
 * mid-commit against this same goal, so this second SUM is guaranteed to
 * see every contribution any transaction that has already committed
 * against this goal contributed — the TRUE combined total. The FIRST call
 * (before the lock) is kept, but demoted to a pure optimization: it only
 * decides whether it's worth taking the lock at all (the common case where
 * nothing crossed even under an understated view never needs to lock).
 * That first result is never used for the authoritative decision or for
 * any event payload.
 *
 * ENGINEERING DECISION (disclosed, not silently assumed): if
 * `computeSavingsGoalProgress` throws `GoalProgressUnavailableError` (an
 * UNRELATED historical contribution/transfer to this same goal has no FX
 * rate for its currency pair), this hook catches that ONE specific error
 * and skips milestone evaluation for this commit — it does NOT re-throw,
 * and does NOT block the triggering `GOAL_CONTRIBUTION`/`TRANSFER` from
 * being created. This mirrors FR-EXP-004's own established principle (the
 * large-amount sanity check "never blocks" the primary financial action),
 * reapplied here: a missing FX rate belonging to some OTHER, older
 * contribution must never prevent recording a brand-new, otherwise-valid
 * one. Milestone state simply stays unchanged for this commit; the next
 * successful progress computation (once the rate is seeded, or via a
 * future explicit `/goals` progress-display call) catches up. Any OTHER
 * unexpected error is NOT swallowed — it propagates normally. UNCHANGED by
 * this correction.
 *
 * Event emission: one `GoalMilestoneReached` `domain_events` row per
 * newly-crossed threshold strictly below 100 (mirrors
 * `evaluateBudgetThresholdsOnExpenseCommit`'s own "one event per crossed
 * threshold" loop exactly — a single large contribution can cross more than
 * one threshold at once, §8.22.2), and a distinct `GoalCompleted` row
 * (never also a `GoalMilestoneReached` for the same 100 crossing) the one
 * time progress first reaches 100 — `detectNewlyCrossedGoalMilestones`'s own
 * `threshold > floor` contract already guarantees `GoalCompleted` never
 * fires twice for the same goal (FR-FIN-014's "further contributions remain
 * possible" without a repeat notification).
 */
export async function evaluateSavingsGoalProgressOnContributionCommit(
  tx: Prisma.TransactionClient,
  context: ContributionCommitGoalContext,
): Promise<void> {
  const goal = await tx.savingsGoal.findUnique({ where: { id: context.goalId } });
  if (!goal || goal.deletedAt !== null) {
    return;
  }

  const targetAmount = formatDecimalAmount(goal.targetAmount);

  // FIRST (unprotected) computation — a pure optimization. Under genuine
  // concurrency this can be understated (see this file's own "SECOND,
  // DISTINCT CORRECTION" doc comment above) — it is used ONLY to decide
  // whether taking the lock below is worth attempting at all, NEVER for
  // the authoritative crossed-threshold decision or any event payload.
  let optimisticProgressPercent: number;
  try {
    const progress = await computeSavingsGoalProgress(tx, {
      goalId: goal.id,
      currency: goal.currency,
      targetAmount,
    });
    optimisticProgressPercent = progress.progressPercent;
  } catch (error) {
    if (error instanceof GoalProgressUnavailableError) {
      return;
    }
    throw error;
  }

  // Fast-path skip using the (possibly stale/understated) values above —
  // avoids taking a row lock for the overwhelmingly common case where
  // nothing crossed even under an understated view. The AUTHORITATIVE
  // decision always happens below, after acquiring the lock and
  // recomputing progress under it.
  if (
    detectNewlyCrossedGoalMilestones(goal.lastMilestoneFired, optimisticProgressPercent).length ===
    0
  ) {
    return;
  }

  // `FOR NO KEY UPDATE`, deliberately NOT the stronger `FOR UPDATE`: this
  // hook runs inside the SAME transaction as a `transactions` row INSERT
  // whose `goal_id` foreign key takes a `FOR KEY SHARE` lock on this exact
  // `savings_goals` row for FK enforcement. `FOR UPDATE` conflicts with
  // `FOR KEY SHARE` — under genuine concurrency, two transactions each
  // holding the other's needed lock deadlock (confirmed empirically: this
  // exact deadlock reproduced during development, `ERROR: deadlock
  // detected... Process A waits for ShareLock... blocked by process B`).
  // `FOR NO KEY UPDATE` is the correct, minimal lock for this write (only
  // `last_milestone_fired`/`status` change, never the primary key) — it
  // still conflicts with a concurrent `FOR NO KEY UPDATE` (the mutual
  // exclusion this function actually needs between two overlapping
  // milestone-hook invocations), but is compatible with `FOR KEY SHARE`,
  // eliminating the deadlock.
  const lockedRows = await tx.$queryRaw<
    Array<{ last_milestone_fired: number | null; status: string }>
  >`
    SELECT last_milestone_fired, status
    FROM savings_goals
    WHERE id = ${goal.id}::uuid AND deleted_at IS NULL
    FOR NO KEY UPDATE
  `;
  if (lockedRows.length === 0) {
    // Goal vanished (soft-deleted) concurrently between the initial read
    // above and this lock attempt.
    return;
  }
  const { last_milestone_fired: trueCurrentMilestone, status: trueCurrentStatus } = lockedRows[0]!;

  // SECOND (protected) computation — the ONLY one ever compared against
  // `trueCurrentMilestone` or written into an event payload. Now that the
  // lock is held, no concurrent transaction can be mid-commit against this
  // same goal, so this SUM is guaranteed to see every contribution any
  // already-committed transaction made — the TRUE combined total, never
  // understated. Same `GoalProgressUnavailableError` best-effort handling
  // as the first call, unchanged: an unrelated missing FX rate still never
  // blocks this commit, it just skips milestone evaluation for it.
  let progressPercent: number;
  try {
    const progress = await computeSavingsGoalProgress(tx, {
      goalId: goal.id,
      currency: goal.currency,
      targetAmount,
    });
    progressPercent = progress.progressPercent;
  } catch (error) {
    if (error instanceof GoalProgressUnavailableError) {
      return;
    }
    throw error;
  }

  const actualCrossedThresholds = detectNewlyCrossedGoalMilestones(
    trueCurrentMilestone,
    progressPercent,
  );
  if (actualCrossedThresholds.length === 0) {
    // A concurrent commit, now visible via the locked read AND the
    // re-computed true progress, already covered this entire threshold
    // range first.
    return;
  }
  const highestNewMilestone = Math.max(...actualCrossedThresholds);

  await tx.savingsGoal.update({
    where: { id: goal.id },
    data: {
      lastMilestoneFired: highestNewMilestone,
      ...(highestNewMilestone >= 100 && trueCurrentStatus === 'active'
        ? { status: 'completed' }
        : {}),
    },
  });

  for (const thresholdPercent of actualCrossedThresholds) {
    if (thresholdPercent >= 100) {
      await tx.domainEvent.create({
        data: {
          eventType: 'GoalCompleted',
          payload: {
            goalId: goal.id,
            userId: goal.userId,
            name: goal.name,
            targetAmount,
            currency: goal.currency,
          },
          status: 'pending',
        },
      });
      continue;
    }
    await tx.domainEvent.create({
      data: {
        eventType: 'GoalMilestoneReached',
        payload: {
          goalId: goal.id,
          userId: goal.userId,
          name: goal.name,
          thresholdPercent,
          progressPercent,
          targetAmount,
          currency: goal.currency,
        },
        status: 'pending',
      },
    });
  }
}
