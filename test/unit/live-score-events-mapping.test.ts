import { vi } from 'vitest'

vi.mock('../../src/videprinter/state/request-counter.ts', () => ({
  canMakeExternalRequest: vi.fn().mockResolvedValue(true),
  noteExternalRequest: vi.fn().mockResolvedValue(undefined),
}))

const { fetchLiveScoreData } = await import('../../src/videprinter/fetchers/live-score.ts')
const config = (await import('../../src/config.ts')).default

function matchWithEventsLink () {
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
    urls: { events: 'https://livescore-api.com/api-client/scores/events.json?id=1' },
  }
}

// The live matches list and the per-match events endpoint are two different URLs, so the mock
// fetcher has to branch on which one is being requested.
function twoStageFetcher (eventsPayload: unknown): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.includes('events.json')) {
      return { ok: true, status: 200, json: async () => eventsPayload } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({ data: { match: [matchWithEventsLink()] } }) } as unknown as Response
  }) as unknown as typeof fetch
}

describe('live-score events endpoint mapping', () => {
  beforeEach(() => {
    config.set('dataSource.liveScore.key', 'test-key')
    config.set('dataSource.liveScore.secret', 'test-secret')
    config.set('dataSource.liveScore.competitions', {
      championship: 3, leagueOne: 4, leagueTwo: 5, faCup: 6, leagueCup: 7,
    })
  })

  test('uses the documented is_home/is_away and player object shape, keyed by the provider event id', async () => {
    const eventsPayload = {
      data: {
        event: [
          { id: 310426483, player: { id: 2170, name: 'Lionel Messi' }, time: 23, event: 'GOAL', sort: 0, info: null, is_home: true, is_away: false },
        ],
      },
    }

    const { goals } = await fetchLiveScoreData(twoStageFetcher(eventsPayload))

    expect(goals).toHaveLength(1)
    expect(goals[0]!.scorer.name).toBe('Lionel Messi')
    expect(goals[0]!.scoringTeam.name).toBe('Blackpool')
    expect(goals[0]!.id).toBe('1-e310426483')
  })

  test('keeps the same id when the scorer is corrected', async () => {
    const original = { data: { event: [{ id: 555, player: { id: 1, name: 'Smith' }, time: 23, event: 'GOAL', sort: 0, is_home: true, is_away: false }] } }
    const corrected = { data: { event: [{ id: 555, player: { id: 1, name: 'Smyth' }, time: 23, event: 'GOAL', sort: 0, is_home: true, is_away: false }] } }

    const before = await fetchLiveScoreData(twoStageFetcher(original))
    const after = await fetchLiveScoreData(twoStageFetcher(corrected))

    expect(before.goals[0]!.id).toBe(after.goals[0]!.id)
    expect(after.goals[0]!.scorer.name).toBe('Smyth')
  })

  test('reads an assist from the info object', async () => {
    const eventsPayload = {
      data: {
        event: [
          { id: 700, player: { id: 1, name: 'Messi' }, time: 23, event: 'GOAL', sort: 0, info: { id: 2, name: 'Di Maria' }, is_home: true, is_away: false },
        ],
      },
    }

    const { goals } = await fetchLiveScoreData(twoStageFetcher(eventsPayload))

    expect(goals[0]!.assist?.name).toBe('Di Maria')
  })

  test('falls back to the ordinal scheme when the provider supplies no event id', async () => {
    const eventsPayload = {
      data: {
        event: [
          { player: { id: 1, name: 'No Id Scorer' }, time: 23, event: 'GOAL', sort: 0, is_home: true, is_away: false },
        ],
      },
    }

    const { goals } = await fetchLiveScoreData(twoStageFetcher(eventsPayload))

    expect(goals[0]!.id).toBe('1-h-1')
  })
})
