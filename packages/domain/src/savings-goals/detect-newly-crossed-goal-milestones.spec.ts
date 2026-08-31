import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GOAL_MILESTONE_THRESHOLDS,
  detectNewlyCrossedGoalMilestones,
} from './detect-newly-crossed-goal-milestones';

describe('detectNewlyCrossedGoalMilestones (FR-FIN-013)', () => {
  it('fires 25% when progress first reaches or exceeds it and nothing has fired yet', () => {
    expect(detectNewlyCrossedGoalMilestones(null, 25)).toEqual([25]);
    expect(detectNewlyCrossedGoalMilestones(null, 30)).toEqual([25]);
  });

  it('fires nothing when progress has not yet reached the first threshold', () => {
    expect(detectNewlyCrossedGoalMilestones(null, 24)).toEqual([]);
  });

  it('fires only thresholds strictly above the already-fired marker', () => {
    expect(detectNewlyCrossedGoalMilestones(25, 50)).toEqual([50]);
    expect(detectNewlyCrossedGoalMilestones(50, 60)).toEqual([]);
  });

  it('fires multiple thresholds at once when a single contribution jumps past more than one (10% -> 80%)', () => {
    expect(detectNewlyCrossedGoalMilestones(null, 80)).toEqual([25, 50, 75]);
  });

  it('fires 100% exactly once for the contribution that reaches or exceeds it', () => {
    expect(detectNewlyCrossedGoalMilestones(75, 100)).toEqual([100]);
    expect(detectNewlyCrossedGoalMilestones(75, 142)).toEqual([100]);
  });

  it('fires nothing once 100% has already fired, even with further contributions (FR-FIN-014)', () => {
    expect(detectNewlyCrossedGoalMilestones(100, 150)).toEqual([]);
  });

  it('fires nothing when progress is unchanged or below the marker', () => {
    expect(detectNewlyCrossedGoalMilestones(50, 50)).toEqual([]);
    expect(detectNewlyCrossedGoalMilestones(50, 40)).toEqual([]);
  });

  it('a contribution landing exactly ON a threshold counts as crossing it (>=, not >)', () => {
    expect(detectNewlyCrossedGoalMilestones(null, 25)).toEqual([25]);
    expect(detectNewlyCrossedGoalMilestones(24, 25)).toEqual([25]);
  });

  it('DEFAULT_GOAL_MILESTONE_THRESHOLDS is exactly [25, 50, 75, 100], ascending', () => {
    expect(DEFAULT_GOAL_MILESTONE_THRESHOLDS).toEqual([25, 50, 75, 100]);
  });
});
