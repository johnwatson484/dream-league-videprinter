import type { GoalEvent, MatchRecord } from '../../src/videprinter/types.ts'
import { aggregateCupEvents } from '../../src/videprinter/aggregation/cup-summary.ts'

function match (overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    fixtureId: '1',
    competition: 'FA Cup',
    homeTeam: 'Bristol City',
    awayTeam: 'Rochdale',
    status: 'FINISHED',
    utcTimestamp: new Date('2026-01-01T15:00:00.000Z'),
    finalScore: '1-0',
    ...overrides
  }
}

function goal (overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: Math.random().toString(36).slice(2),
    fixtureId: '1',
    competition: 'FA Cup',
    utcTimestamp: new Date('2026-01-01T15:00:00.000Z'),
    minute: 10,
    scoringTeam: { name: 'Bristol City' },
    concedingTeam: { name: 'Rochdale' },
    scorer: { name: 'Fletcher, Ashley', normalizedName: 'fletcher ashley' },
    assist: null,
    scoreAfterEvent: { home: 1, away: 0 },
    phase: 'LIVE',
    source: 'mock',
    ...overrides
  }
}

const scoredFor = (team: string, playerId: number, player: string): NonNullable<GoalEvent['potentialGoalFor']> => ({
  managerId: 1,
  manager: 'Billy Gordon',
  player,
  playerId,
  team,
  confidence: 0.9,
  substitute: false
})

const concededFor = (team: string, teamId: number): NonNullable<GoalEvent['potentialConcedingFor']> => ({
  managerId: 2,
  manager: 'Bob Brown',
  team,
  teamId,
  confidence: 0.9,
  substitute: false
})

describe('aggregateCupEvents', () => {
  test('does not conflate Bristol City with Bristol Rovers across separate cup fixtures', () => {
    const matches: MatchRecord[] = [
      match({ fixtureId: 'f1', homeTeam: 'Bristol City', awayTeam: 'Rochdale', utcTimestamp: new Date('2026-01-01T15:00:00.000Z') }),
      match({ fixtureId: 'f2', homeTeam: 'Bristol Rovers', awayTeam: 'Wycombe', utcTimestamp: new Date('2026-01-08T15:00:00.000Z') })
    ]

    const events: GoalEvent[] = [
      goal({
        fixtureId: 'f1',
        utcTimestamp: new Date('2026-01-01T15:30:00.000Z'),
        potentialGoalFor: scoredFor('Bristol City', 1, 'City Scorer'),
        potentialConcedingFor: concededFor('Rochdale', 10)
      }),
      goal({
        fixtureId: 'f2',
        scoringTeam: { name: 'Bristol Rovers' },
        concedingTeam: { name: 'Wycombe' },
        utcTimestamp: new Date('2026-01-08T15:30:00.000Z'),
        potentialGoalFor: scoredFor('Bristol Rovers', 2, 'Rovers Scorer'),
        potentialConcedingFor: concededFor('Wycombe', 11)
      })
    ]

    const result = aggregateCupEvents(events, matches)

    expect(result.goalsCup.map(g => g.playerId).sort()).toEqual([1, 2])
    expect(result.concededCup.map(c => c.teamId).sort()).toEqual([10, 11])
  })

  test('does not conflate Sheffield United with Sheffield Wednesday across separate cup fixtures', () => {
    const matches: MatchRecord[] = [
      match({ fixtureId: 'f1', homeTeam: 'Sheffield United', awayTeam: 'Rochdale', utcTimestamp: new Date('2026-01-01T15:00:00.000Z') }),
      match({ fixtureId: 'f2', homeTeam: 'Sheffield Wednesday', awayTeam: 'Wycombe', utcTimestamp: new Date('2026-01-08T15:00:00.000Z') })
    ]

    const events: GoalEvent[] = [
      goal({
        fixtureId: 'f1',
        utcTimestamp: new Date('2026-01-01T15:30:00.000Z'),
        potentialGoalFor: scoredFor('Sheffield United', 1, 'United Scorer'),
        potentialConcedingFor: concededFor('Rochdale', 10)
      }),
      goal({
        fixtureId: 'f2',
        scoringTeam: { name: 'Sheffield Wednesday' },
        concedingTeam: { name: 'Wycombe' },
        utcTimestamp: new Date('2026-01-08T15:30:00.000Z'),
        potentialGoalFor: scoredFor('Sheffield Wednesday', 2, 'Wednesday Scorer'),
        potentialConcedingFor: concededFor('Wycombe', 11)
      })
    ]

    const result = aggregateCupEvents(events, matches)

    expect(result.goalsCup.map(g => g.playerId).sort()).toEqual([1, 2])
    expect(result.concededCup.map(c => c.teamId).sort()).toEqual([10, 11])
  })
})
