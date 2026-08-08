import type { GoalEvent } from '../../src/videprinter/types.ts'
import { excludeShootoutGoals } from '../../src/videprinter/aggregation/exclude-shootout-goals.ts'

function goal (overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: Math.random().toString(36).slice(2),
    fixtureId: '1',
    competition: 'FA Cup',
    utcTimestamp: new Date(),
    minute: 10,
    scoringTeam: { name: 'Blackpool' },
    concedingTeam: { name: 'Bolton' },
    scorer: { name: 'Fletcher, Ashley', normalizedName: 'fletcher ashley' },
    assist: null,
    scoreAfterEvent: { home: 1, away: 0 },
    phase: 'LIVE',
    source: 'mock',
    ...overrides
  }
}

describe('excludeShootoutGoals', () => {
  test('keeps all goals when the running total strictly increases', () => {
    const goals = [
      goal({ id: 'a', utcTimestamp: new Date('2026-08-08T12:00:00Z'), scoreAfterEvent: { home: 1, away: 0 } }),
      goal({ id: 'b', utcTimestamp: new Date('2026-08-08T12:10:00Z'), scoreAfterEvent: { home: 1, away: 1 } }),
      goal({ id: 'c', utcTimestamp: new Date('2026-08-08T12:20:00Z'), scoreAfterEvent: { home: 2, away: 1 } }),
    ]

    expect(excludeShootoutGoals(goals).map(g => g.id)).toEqual(['a', 'b', 'c'])
  })

  test('drops penalty shootout kicks that repeat the final score', () => {
    const goals = [
      goal({ id: 'a', utcTimestamp: new Date('2026-08-08T12:00:00Z'), scoreAfterEvent: { home: 1, away: 0 } }),
      goal({ id: 'b', utcTimestamp: new Date('2026-08-08T13:00:00Z'), scoreAfterEvent: { home: 1, away: 1 } }),
      goal({ id: 'shootout-1', utcTimestamp: new Date('2026-08-08T14:00:00Z'), scoreAfterEvent: { home: 1, away: 1 } }),
      goal({ id: 'shootout-2', utcTimestamp: new Date('2026-08-08T14:01:00Z'), scoreAfterEvent: { home: 1, away: 1 } }),
      goal({ id: 'shootout-3', utcTimestamp: new Date('2026-08-08T14:02:00Z'), scoreAfterEvent: { home: 1, away: 1 } }),
    ]

    expect(excludeShootoutGoals(goals).map(g => g.id)).toEqual(['a', 'b'])
  })

  test('keeps goals with an unparseable score rather than guessing', () => {
    const goals = [
      goal({ id: 'unknown', utcTimestamp: new Date('2026-08-08T12:00:00Z'), scoreAfterEvent: { home: null, away: null } }),
      goal({ id: 'a', utcTimestamp: new Date('2026-08-08T12:10:00Z'), scoreAfterEvent: { home: 1, away: 0 } }),
    ]

    expect(excludeShootoutGoals(goals).map(g => g.id)).toEqual(['unknown', 'a'])
  })

  test('tracks each fixture independently and is order-independent', () => {
    const goals = [
      // Fixture 2's goals arrive first and out of chronological order relative to fixture 1.
      goal({ id: 'fixture2-b', fixtureId: '2', utcTimestamp: new Date('2026-08-08T13:00:00Z'), scoreAfterEvent: { home: 2, away: 0 } }),
      goal({ id: 'fixture1-shootout', fixtureId: '1', utcTimestamp: new Date('2026-08-08T14:00:00Z'), scoreAfterEvent: { home: 1, away: 1 } }),
      goal({ id: 'fixture2-a', fixtureId: '2', utcTimestamp: new Date('2026-08-08T12:00:00Z'), scoreAfterEvent: { home: 1, away: 0 } }),
      goal({ id: 'fixture1-a', fixtureId: '1', utcTimestamp: new Date('2026-08-08T12:00:00Z'), scoreAfterEvent: { home: 1, away: 1 } }),
    ]

    const result = excludeShootoutGoals(goals).map(g => g.id)
    expect(result).toContain('fixture1-a')
    expect(result).toContain('fixture2-a')
    expect(result).toContain('fixture2-b')
    expect(result).not.toContain('fixture1-shootout')
  })
})
