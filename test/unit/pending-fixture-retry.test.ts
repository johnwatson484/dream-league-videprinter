import { vi } from 'vitest'

vi.mock('../../src/videprinter/state/request-counter.ts', () => ({
  canMakeExternalRequest: vi.fn().mockResolvedValue(true),
  noteExternalRequest: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../../src/videprinter/storage/mongo.ts', () => ({
  fetchActiveEventsForFixture: vi.fn().mockResolvedValue([]),
}))

const { fetchLiveScoreData, retryPendingFixtures, clearPendingFixtures } = await import('../../src/videprinter/fetchers/live-score.ts')
const { eventsStore } = await import('../../src/videprinter/state/events-store.ts')
const { fixturePollMemo } = await import('../../src/videprinter/state/fixture-poll-memo.ts')
const config = (await import('../../src/config.ts')).default

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
    scores: { score: '2 - 0' },
    goals: [],
    urls: { events: 'https://example.com/matches/1/events.json' },
    ...overrides
  }
}

function eventsResponse (events: Record<string, unknown>[]): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => ({ data: { event: events } }) }
}

const oneGoal = { id: 'e1', time: '23', player_name: 'Fletcher, Ashley', home_away: 'h', event: 'goal' }
const secondGoal = { id: 'e2', time: '67', player_name: 'Second, Sam', home_away: 'h', event: 'goal' }

function fetcherReturning (matches: unknown[], events: Record<string, unknown>[]): typeof fetch {
  const fn = vi.fn()
  fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { match: matches } }) })
  fn.mockResolvedValueOnce(eventsResponse(events))
  return fn as unknown as typeof fetch
}

describe('pending fixture retry', () => {
  beforeEach(() => {
    config.set('dataSource.liveScore.key', 'test-key')
    config.set('dataSource.liveScore.secret', 'test-secret')
    config.set('dataSource.liveScore.competitions', {
      championship: 3, leagueOne: 4, leagueTwo: 5, faCup: 6, leagueCup: 7
    })
    config.set('dataSource.pendingFixtureGraceMs', 1000 * 60 * 10)
    eventsStore.clear()
    fixturePollMemo.clear()
    clearPendingFixtures()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('emits the goals already confirmed while the events list still lags the score', async () => {
    const first = await fetchLiveScoreData(fetcherReturning([match()], [oneGoal]))

    expect(first.goals.map(g => g.id)).toEqual(['1-e1'])
  })

  test('picks up the remaining goal once a later retry catches up with the score', async () => {
    await fetchLiveScoreData(fetcherReturning([match()], [oneGoal]))

    const retryFetcher = vi.fn().mockResolvedValue(eventsResponse([oneGoal, secondGoal])) as unknown as typeof fetch
    const retry = await retryPendingFixtures(retryFetcher)

    expect(retry.goals.map(g => g.id)).toEqual(['1-e1', '1-e2'])
    expect(retryFetcher).toHaveBeenCalledTimes(1)
  })

  test('stops retrying once resolved', async () => {
    await fetchLiveScoreData(fetcherReturning([match()], [oneGoal]))

    const retryFetcher = vi.fn().mockResolvedValue(eventsResponse([oneGoal, secondGoal])) as unknown as typeof fetch
    await retryPendingFixtures(retryFetcher)

    const secondRetryFetcher = vi.fn() as unknown as typeof fetch
    const second = await retryPendingFixtures(secondRetryFetcher)

    expect(second.goals).toEqual([])
    expect(secondRetryFetcher).not.toHaveBeenCalled()
  })

  test('gives up on a fixture once it has been pending longer than the grace period', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T15:00:00Z'))
    config.set('dataSource.pendingFixtureGraceMs', 1000 * 60 * 10)

    await fetchLiveScoreData(fetcherReturning([match()], [oneGoal]))

    vi.setSystemTime(new Date('2030-01-01T15:20:00Z'))

    const retryFetcher = vi.fn() as unknown as typeof fetch
    const retry = await retryPendingFixtures(retryFetcher)

    expect(retry.goals).toEqual([])
    expect(retryFetcher).not.toHaveBeenCalled()
  })
})
