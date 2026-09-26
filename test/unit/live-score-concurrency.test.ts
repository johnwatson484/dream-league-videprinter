import { vi } from 'vitest'

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

function match (id: number): Record<string, unknown> {
  return {
    id,
    status: 'IN PLAY',
    scheduled: '15:00',
    added: '2026-08-15 14:45:00',
    competition: { id: 4, name: 'League One' },
    home_name: 'Blackpool',
    away_name: 'Bolton',
    scores: { score: '1 - 0' },
    goals: [],
    urls: { events: `https://example.com/matches/${id}/events.json` },
  }
}

function goalEvent (id: number): Record<string, unknown> {
  return { id, event: 'GOAL', time: '23', scorer: 'Fletcher, Ashley', home_away: 'h', score: '1 - 0' }
}

// Records how many events requests are in flight at once, releasing them all together so
// the pool has every chance to open as many as it is willing to.
function trackingFetcher (matches: unknown[]): { fetcher: typeof fetch; peak: () => number } {
  let inFlight = 0
  let peak = 0
  const pending: Array<() => void> = []

  const fetcher = vi.fn(async (url: string) => {
    if (!String(url).includes('/events')) {
      return { ok: true, status: 200, json: async () => ({ data: { match: matches } }) }
    }

    inFlight++
    peak = Math.max(peak, inFlight)
    const id = Number(/match_id=(\d+)/.exec(String(url))?.[1])

    await new Promise<void>(resolve => {
      pending.push(resolve)
      // Release the whole batch once no more are arriving.
      setTimeout(() => { pending.splice(0).forEach(release => { release() }) }, 0)
    })

    inFlight--
    return { ok: true, status: 200, json: async () => ({ data: { event: [goalEvent(id * 1000)] } }) }
  })

  return { fetcher: fetcher as unknown as typeof fetch, peak: () => peak }
}

describe('fixture fetch concurrency', () => {
  beforeEach(() => {
    config.set('dataSource.liveScore.key', 'test-key')
    config.set('dataSource.liveScore.secret', 'test-secret')
    config.set('dataSource.liveScore.competitions', {
      championship: 3, leagueOne: 4, leagueTwo: 5, faCup: 6, leagueCup: 7
    })
    eventsStore.clear()
    fixturePollMemo.clear()
  })

  afterEach(() => {
    config.set('dataSource.fixtureConcurrency', 5)
  })

  test('fetches several fixtures at once rather than one after another', async () => {
    config.set('dataSource.fixtureConcurrency', 4)
    const matches = [1, 2, 3, 4, 5, 6].map(match)
    const { fetcher, peak } = trackingFetcher(matches)

    const result = await fetchLiveScoreData(fetcher)

    expect(peak()).toBe(4)
    expect(result.goals).toHaveLength(6)
  })

  test('never exceeds the configured concurrency', async () => {
    config.set('dataSource.fixtureConcurrency', 2)
    const matches = [1, 2, 3, 4, 5, 6].map(match)
    const { fetcher, peak } = trackingFetcher(matches)

    await fetchLiveScoreData(fetcher)

    expect(peak()).toBe(2)
  })

  test('returns goals for every fixture when there are fewer than the limit', async () => {
    config.set('dataSource.fixtureConcurrency', 10)
    const matches = [1, 2].map(match)
    const { fetcher } = trackingFetcher(matches)

    const result = await fetchLiveScoreData(fetcher)

    expect(result.goals.map(g => g.fixtureId).sort()).toEqual(['1', '2'])
  })
})
