import type { GoalEvent } from '../../src/videprinter/types.ts'
import { excludeShootoutGoals } from '../../src/videprinter/aggregation/exclude-shootout-goals.ts'

function goal (overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: Math.random().toString(36).slice(2),
    fixtureId: '1',
    competition: 'EFL Cup',
    utcTimestamp: new Date(),
    minute: 10,
    scoringTeam: { name: 'Blackpool' },
    concedingTeam: { name: 'Bolton' },
    scorer: { name: 'Fletcher, Ashley', normalizedName: 'fletcher ashley' },
    assist: null,
    scoreAfterEvent: { home: 1, away: 0 },
    phase: 'IN PLAY',
    source: 'mock',
    ...overrides
  }
}

describe('excludeShootoutGoals', () => {
  test('keeps goals scored during normal time', () => {
    const goals = [
      goal({ id: 'a', minute: 23, scoreAfterEvent: { home: 1, away: 0 } }),
      goal({ id: 'b', minute: 67, scoreAfterEvent: { home: 1, away: 1 } }),
    ]

    expect(excludeShootoutGoals(goals).map(g => g.id)).toEqual(['a', 'b'])
  })

  test('drops shootout kicks reported at minute 120, even though the score keeps climbing normally', () => {
    // Matches real provider behaviour: the data source has no per-kick timing during a
    // shootout, so every kick shares minute 120 - but the running score total still climbs
    // as if it were a normal match, so a score-based check alone cannot detect these.
    const goals = [
      goal({ id: 'a', minute: 40, scoreAfterEvent: { home: 0, away: 1 } }),
      goal({ id: 'b', minute: 81, scoreAfterEvent: { home: 1, away: 1 } }),
      goal({ id: 'shootout-1', minute: 120, phase: 'FINISHED', scoreAfterEvent: { home: 1, away: 2 } }),
      goal({ id: 'shootout-2', minute: 120, phase: 'FINISHED', scoreAfterEvent: { home: 2, away: 2 } }),
      goal({ id: 'shootout-3', minute: 120, phase: 'FINISHED', scoreAfterEvent: { home: 2, away: 3 } }),
    ]

    expect(excludeShootoutGoals(goals).map(g => g.id)).toEqual(['a', 'b'])
  })

  test('drops minute-120 kicks even while the match still shows IN PLAY', () => {
    // phase isn't a reliable signal - it just reflects match status when the event was first
    // ingested, not when it happened, so the filter must not depend on it.
    const goals = [
      goal({ id: 'a', minute: 81, scoreAfterEvent: { home: 1, away: 1 } }),
      goal({ id: 'shootout-1', minute: 120, phase: 'IN PLAY', scoreAfterEvent: { home: 2, away: 1 } }),
    ]

    expect(excludeShootoutGoals(goals).map(g => g.id)).toEqual(['a'])
  })

  test('keeps a goal with an unknown minute rather than guessing', () => {
    const goals = [
      goal({ id: 'unknown-minute', minute: null }),
      goal({ id: 'a', minute: 23 }),
    ]

    expect(excludeShootoutGoals(goals).map(g => g.id)).toEqual(['unknown-minute', 'a'])
  })

  test('does not drop a goal in the 90-119th minute range', () => {
    const goals = [goal({ id: 'late-goal', minute: 119 })]

    expect(excludeShootoutGoals(goals).map(g => g.id)).toEqual(['late-goal'])
  })
})
