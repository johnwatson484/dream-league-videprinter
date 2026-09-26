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

function match (overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 735057,
    status: 'IN PLAY',
    scheduled: '15:00',
    added: '2026-08-15 14:45:00',
    competition: { id: 4, name: 'League One' },
    home: { name: 'Blackpool' },
    away: { name: 'Bolton' },
    home_name: 'Blackpool',
    away_name: 'Bolton',
    scores: { score: '1 - 1' },
    goals: [],
    // The provider points this at scores/events.json?id=, which hangs for any numeric id.
    // It is only used as a signal that events exist; the URL is rebuilt by the fetcher.
    urls: { events: 'https://livescore-api.com/api-client/scores/events.json?id=735057' },
    ...overrides
  }
}

// Verbatim shape returned by matches/events.json?match_id=: player/info are objects and
// the side is expressed with is_home/is_away booleans rather than home_away/side/team.
const eventsPayload = [
  {
    id: 421058736,
    player: { id: 3046, name: 'Paudie O’Connor' },
    time: 47,
    event: 'GOAL',
    sort: 2,
    info: { id: 122990, name: 'P. Lane' },
    is_home: false,
    is_away: true,
    label: 'Goal'
  },
  {
    id: 421058737,
    player: { id: 141766, name: 'Jayden Wareham' },
    time: 61,
    event: 'GOAL',
    sort: 3,
    info: null,
    is_home: true,
    is_away: false,
    label: 'Goal'
  },
  {
    id: 421058738,
    player: { id: 131966, name: 'D. van Wageningen' },
    time: 28,
    event: 'YELLOW_CARD',
    sort: 1,
    info: null,
    is_home: false,
    is_away: true,
    label: 'Yellow card'
  }
]

function fetcherFor (events: unknown[]): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/events')) {
      return { ok: true, status: 200, json: async () => ({ data: { event: events } }) }
    }
    return { ok: true, status: 200, json: async () => ({ data: { match: [match()] } }) }
  })
}

describe('matches/events.json payload shape', () => {
  beforeEach(() => {
    config.set('dataSource.liveScore.key', 'test-key')
    config.set('dataSource.liveScore.secret', 'test-secret')
    config.set('dataSource.liveScore.host', 'livescore-api.com')
    config.set('dataSource.liveScore.competitions', {
      championship: 3, leagueOne: 4, leagueTwo: 5, faCup: 6, leagueCup: 7
    })
    eventsStore.clear()
    fixturePollMemo.clear()
    mockCanMakeExternalRequest.mockResolvedValue(true)
  })

  test('requests matches/events.json by match_id rather than the provider url that hangs', async () => {
    const fetcher = fetcherFor(eventsPayload)

    await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    const eventsCall = fetcher.mock.calls.map(call => String(call[0])).find(url => url.includes('/events'))
    expect(eventsCall).toContain('/api-client/matches/events.json')
    expect(eventsCall).toContain('match_id=735057')
    expect(eventsCall).not.toContain('scores/events.json')
  })

  test('extracts goals when the side is given as is_home/is_away booleans', async () => {
    const fetcher = fetcherFor(eventsPayload)

    const result = await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    expect(result.goals).toHaveLength(2)
    expect(result.goals.map(g => g.minute)).toEqual([47, 61])
  })

  test('reads scorer and assist from the nested player and info objects', async () => {
    const fetcher = fetcherFor(eventsPayload)

    const result = await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    const [away, home] = result.goals
    expect(away?.scorer.name).toBe('Paudie O’Connor')
    expect(away?.assist?.name).toBe('P. Lane')
    expect(home?.scorer.name).toBe('Jayden Wareham')
    expect(home?.assist).toBeNull()
  })

  test('ignores non-goal events in the same payload', async () => {
    const fetcher = fetcherFor(eventsPayload)

    const result = await fetchLiveScoreData(fetcher as unknown as typeof fetch)

    expect(result.goals.map(g => g.scorer.name)).not.toContain('D. van Wageningen')
  })
})
