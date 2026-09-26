import { vi } from 'vitest'
import type { GoalEvent } from '../../src/videprinter/types.ts'

const { mockNoteExternalRequest, mockCanMakeExternalRequest } = vi.hoisted(() => ({
  mockNoteExternalRequest: vi.fn().mockResolvedValue(undefined),
  mockCanMakeExternalRequest: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/videprinter/state/request-counter.ts', () => ({
  canMakeExternalRequest: mockCanMakeExternalRequest,
  noteExternalRequest: mockNoteExternalRequest,
}))
vi.mock('../../src/videprinter/storage/mongo.ts', () => ({
  fetchActiveEventsForFixture: vi.fn().mockResolvedValue([]),
}))

const { fetchLiveScoreData } = await import('../../src/videprinter/fetchers/live-score.ts')
const { eventsStore } = await import('../../src/videprinter/state/events-store.ts')
const { fixturePollMemo } = await import('../../src/videprinter/state/fixture-poll-memo.ts')
const config = (await import('../../src/config.ts')).default

const EVENTS_URL = 'https://example.com/matches/1/events.json'

function match (overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    goals: [],
    urls: { events: EVENTS_URL },
    ...overrides
  }
}

const goalEvent = { id: 101, event: 'GOAL', time: '23', scorer: 'Fletcher, Ashley', home_away: 'h', score: '1 - 0' }

function fetcherFor (matches: unknown[], events: unknown[] = [goalEvent]): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/events')) {
      return { ok: true, status: 200, json: async () => ({ data: { event: events } }) }
    }
    return { ok: true, status: 200, json: async () => ({ data: { match: matches } }) }
  })
}

function eventsRequestCount (fetcher: ReturnType<typeof vi.fn>): number {
  return fetcher.mock.calls.filter(call => String(call[0]).includes('/events')).length
}

function storeGoals (goals: GoalEvent[]): void {
  for (const goal of goals) { eventsStore.add(goal) }
}

describe('per-match events request budget', () => {
  beforeEach(() => {
    config.set('dataSource.liveScore.key', 'test-key')
    config.set('dataSource.liveScore.secret', 'test-secret')
    config.set('dataSource.liveScore.competitions', {
      championship: 3, leagueOne: 4, leagueTwo: 5, faCup: 6, leagueCup: 7
    })
    config.set('dataSource.eventsRefreshMs', 1000 * 60 * 15)
    eventsStore.clear()
    fixturePollMemo.clear()
    mockCanMakeExternalRequest.mockResolvedValue(true)
    mockNoteExternalRequest.mockClear()
  })

  test('does not re-fetch events for a fixture whose score and status have not moved', async () => {
    const fetcher = fetcherFor([match()])

    const first = await fetchLiveScoreData(fetcher as unknown as typeof fetch)
    storeGoals(first.goals)
    const second = await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    expect(first.goals).toHaveLength(1)
    expect(second.goals).toEqual([])
    expect(eventsRequestCount(fetcher)).toBe(1)
  })

  test('re-fetches a fixture whose score has moved since the last poll', async () => {
    const fetcher = fetcherFor([match()])
    const first = await fetchLiveScoreData(fetcher as unknown as typeof fetch)
    storeGoals(first.goals)

    const secondEvents = [goalEvent, { id: 102, event: 'GOAL', time: '67', scorer: 'Second, Sam', home_away: 'h', score: '2 - 0' }]
    const movedOn = fetcherFor([match({ scores: { score: '2 - 0' } })], secondEvents)
    const second = await fetchLiveScoreData(movedOn as unknown as typeof fetch)

    expect(eventsRequestCount(movedOn)).toBe(1)
    expect(second.goals.map(g => g.id)).toEqual(['1-102'])
  })

  test('still re-checks a live fixture once the refresh interval has elapsed, so corrections are not missed', async () => {
    config.set('dataSource.eventsRefreshMs', 0)
    const fetcher = fetcherFor([match()])

    const first = await fetchLiveScoreData(fetcher as unknown as typeof fetch)
    storeGoals(first.goals)
    await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    expect(eventsRequestCount(fetcher)).toBe(2)
  })

  test('stops re-fetching a finished fixture that reconciles with its final score', async () => {
    config.set('dataSource.eventsRefreshMs', 0)
    const fetcher = fetcherFor([match({ status: 'FT' })])

    const first = await fetchLiveScoreData(fetcher as unknown as typeof fetch)
    storeGoals(first.goals)
    await fetchLiveScoreData(fetcher as unknown as typeof fetch)
    await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    expect(eventsRequestCount(fetcher)).toBe(1)
  })

  test('re-fetches a fixture whose stored goals do not add up to the score', async () => {
    config.set('dataSource.eventsRefreshMs', 1000 * 60 * 15)
    const fetcher = fetcherFor([match()])

    await fetchLiveScoreData(fetcher as unknown as typeof fetch)
    await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    expect(eventsRequestCount(fetcher)).toBe(2)
  })

  test('treats a rejected events request as a failed poll, not an empty one', async () => {
    eventsStore.add({
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
    })

    const fetcher = vi.fn()
    fetcher.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { match: [match()] } }) })
    fetcher.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })

    const { goals, retractions } = await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    expect(goals).toEqual([])
    expect(retractions).toEqual([])
  })

  test('counts a request that failed, because the provider charged us for it either way', async () => {
    const fetcher = vi.fn()
    fetcher.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { match: [match()] } }) })
    fetcher.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })

    await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    expect(mockNoteExternalRequest).toHaveBeenCalledTimes(2)
  })

  test('does not issue the events request at all once the daily cap is reached', async () => {
    const fetcher = fetcherFor([match()])
    mockCanMakeExternalRequest.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const { goals } = await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    expect(eventsRequestCount(fetcher)).toBe(0)
    expect(goals).toEqual([])
  })
})
