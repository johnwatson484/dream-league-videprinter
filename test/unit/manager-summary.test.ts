import type { GoalEvent } from '../../src/videprinter/types.ts'
import { aggregateEventsByManager } from '../../src/videprinter/aggregation/manager-summary.ts'

function goal (overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: Math.random().toString(36).slice(2),
    fixtureId: '1',
    competition: 'Championship',
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

const scoredFor = (managerId: number, manager: string, playerId: number, player: string): NonNullable<GoalEvent['potentialGoalFor']> => ({
  managerId,
  manager,
  player,
  playerId,
  team: 'Blackpool',
  confidence: 0.9,
  substitute: false
})

const concededFor = (managerId: number, manager: string): NonNullable<GoalEvent['potentialConcedingFor']> => ({
  managerId,
  manager,
  team: 'Bolton',
  teamId: 16,
  confidence: 0.9,
  substitute: false
})

describe('aggregateEventsByManager', () => {
  test('returns nothing when no events are matched to a manager', () => {
    expect(aggregateEventsByManager([goal(), goal()])).toEqual([])
  })

  test('counts goals for the matched manager', () => {
    const result = aggregateEventsByManager([
      goal({ potentialGoalFor: scoredFor(1, 'Billy Gordon', 282, 'Fletcher, Ashley') }),
      goal({ potentialGoalFor: scoredFor(1, 'Billy Gordon', 282, 'Fletcher, Ashley') })
    ])

    expect(result).toHaveLength(1)
    expect(result[0]!.managerId).toBe(1)
    expect(result[0]!.goals).toBe(2)
  })

  test('groups repeat goals into a single scorer entry', () => {
    const result = aggregateEventsByManager([
      goal({ potentialGoalFor: scoredFor(1, 'Billy Gordon', 282, 'Fletcher, Ashley') }),
      goal({ potentialGoalFor: scoredFor(1, 'Billy Gordon', 282, 'Fletcher, Ashley') }),
      goal({ potentialGoalFor: scoredFor(1, 'Billy Gordon', 367, 'McCrorie, Ross') })
    ])

    expect(result[0]!.scorers).toEqual([
      { playerId: 282, name: 'Fletcher, Ashley', goals: 2 },
      { playerId: 367, name: 'McCrorie, Ross', goals: 1 }
    ])
  })

  test('counts conceded goals against the goalkeeper manager', () => {
    const result = aggregateEventsByManager([
      goal({ potentialConcedingFor: concededFor(2, 'Bob Brown') })
    ])

    expect(result).toEqual([{ managerId: 2, manager: 'Bob Brown', goals: 0, conceded: 1, scorers: [] }])
  })

  test('records a goal for the scorer and against the keeper in one event', () => {
    const result = aggregateEventsByManager([
      goal({
        potentialGoalFor: scoredFor(1, 'Billy Gordon', 282, 'Fletcher, Ashley'),
        potentialConcedingFor: concededFor(2, 'Bob Brown')
      })
    ])

    expect(result).toHaveLength(2)
    expect(result.find(m => m.managerId === 1)!.goals).toBe(1)
    expect(result.find(m => m.managerId === 2)!.conceded).toBe(1)
  })

  test('handles a manager both scoring and conceding', () => {
    const result = aggregateEventsByManager([
      goal({ potentialGoalFor: scoredFor(1, 'Billy Gordon', 282, 'Fletcher, Ashley') }),
      goal({ potentialConcedingFor: concededFor(1, 'Billy Gordon') })
    ])

    expect(result).toEqual([{
      managerId: 1,
      manager: 'Billy Gordon',
      goals: 1,
      conceded: 1,
      scorers: [{ playerId: 282, name: 'Fletcher, Ashley', goals: 1 }]
    }])
  })
})
