import { vi } from 'vitest'
import type { GoalEvent } from '../../src/videprinter/types.ts'

vi.mock('../../src/videprinter/state/request-counter.ts', () => ({
  canMakeExternalRequest: vi.fn().mockResolvedValue(true),
  noteExternalRequest: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../../src/videprinter/storage/mongo.ts', () => ({
  fetchActiveEventsForFixture: vi.fn().mockResolvedValue([]),
}))

const { fetchLiveScoreData } = await import('../../src/videprinter/fetchers/live-score.ts')
const { eventsStore } = await import('../../src/videprinter/state/events-store.ts')
const config = (await import('../../src/config.ts')).default

interface MatchOverrides {
  id?: number
  status?: string
  scheduled?: string
  added?: string
  scores?: { score: string }
  goals?: { time: string; scorer: string; score: string; home_away: string }[]
  urls?: { events?: string } | undefined
}

function match (overrides: MatchOverrides = {}): Record<string, unknown> {
  return {
    id: 1,
    status: 'IN PLAY',
    scheduled: '15:00',
    added: '2026-08-15 14:45:00',
    competition: { id: 4, name: 'League One' },
    home: { name: 'Blackpool' },
    away: { name: 'Bolton' },
    home_name: 'Blackpool',
    away_name: 'Bolton',
    scores: { score: '1 - 0' },
    goals: [{ time: '23', scorer: 'Fletcher, Ashley', score: '1 - 0', home_away: 'h' }],
    ...overrides
  }
}

function existingGoal (overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: '1-h-1',
    fixtureId: '1',
    competition: 'League One',
    utcTimestamp: new Date('2026-08-15T15:23:00.000Z'),
    minute: 23,
    scoringTeam: { name: 'Blackpool' },
    concedingTeam: { name: 'Bolton' },
    scorer: { name: 'Fletcher, Ashley', normalizedName: 'fletcher, ashley' },
    assist: null,
    scoreAfterEvent: { home: 1, away: 0 },
    phase: 'IN PLAY',
    source: 'live-score',
    ...overrides
  }
}

function fetcherReturning (matches: unknown[]): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { match: matches } })
  }) as unknown as typeof fetch
}

// The live.json request resolves first, then any per-match events request(s) - so a
// sequenced fetcher lets the second call behave differently to the first.
function fetcherWithEventsFailure (matches: unknown[]): typeof fetch {
  const fn = vi.fn()
  fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { match: matches } }) })
  fn.mockRejectedValueOnce(new Error('ECONNRESET'))
  return fn as unknown as typeof fetch
}

describe('goal retraction safety gate', () => {
  beforeEach(() => {
    config.set('dataSource.liveScore.key', 'test-key')
    config.set('dataSource.liveScore.secret', 'test-secret')
    config.set('dataSource.liveScore.competitions', {
      championship: 3, leagueOne: 4, leagueTwo: 5, faCup: 6, leagueCup: 7
    })
    eventsStore.clear()
  })

  test('does not retract a goal that is reconfirmed, unchanged, this poll', async () => {
    eventsStore.add(existingGoal())

    const { retractions } = await fetchLiveScoreData(fetcherReturning([match()]))

    expect(retractions).toEqual([])
  })

  test('retracts a goal when the score itself confirms fewer goals than stored', async () => {
    eventsStore.add(existingGoal({ id: '1-h-1' }))
    eventsStore.add(existingGoal({ id: '1-h-2', minute: 67 }))

    const { retractions } = await fetchLiveScoreData(fetcherReturning([match({
      scores: { score: '1 - 0' },
      goals: [{ time: '23', scorer: 'Fletcher, Ashley', score: '1 - 0', home_away: 'h' }]
    })]))

    expect(retractions).toEqual([{ id: '1-h-2', fixtureId: '1' }])
  })

  test('retracts down to zero when the score itself confirms the goals no longer stand', async () => {
    eventsStore.add(existingGoal({ id: '1-h-1' }))

    const { retractions } = await fetchLiveScoreData(fetcherReturning([match({
      scores: { score: '0 - 0' },
      goals: []
    })]))

    expect(retractions).toEqual([{ id: '1-h-1', fixtureId: '1' }])
  })

  test('does not retract stored goals when the events fetch fails for a match the score says still has goals', async () => {
    eventsStore.add(existingGoal({ id: '1-h-1' }))
    eventsStore.add(existingGoal({ id: '1-h-2', minute: 67 }))

    const flakyMatch = match({
      scores: { score: '2 - 0' },
      goals: [],
      urls: { events: 'https://example.com/matches/1/events.json' }
    })

    const { retractions } = await fetchLiveScoreData(fetcherWithEventsFailure([flakyMatch]))

    expect(retractions).toEqual([])
  })

  test('does not retract stored goals when there is no events link to fetch fresh detail from', async () => {
    eventsStore.add(existingGoal({ id: '1-h-1' }))
    eventsStore.add(existingGoal({ id: '1-h-2', minute: 67 }))

    const finishedMatch = match({ scores: { score: '2 - 0' }, goals: [], urls: undefined })

    const { retractions } = await fetchLiveScoreData(fetcherReturning([finishedMatch]))

    expect(retractions).toEqual([])
  })
})
