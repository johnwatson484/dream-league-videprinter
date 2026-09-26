import { vi } from 'vitest'

vi.mock('../../src/videprinter/state/request-counter.ts', () => ({
  canMakeExternalRequest: vi.fn().mockResolvedValue(true),
  noteExternalRequest: vi.fn().mockResolvedValue(undefined),
}))

const { fetchLiveScoreData } = await import('../../src/videprinter/fetchers/live-score.ts')
const config = (await import('../../src/config.ts')).default

interface MatchOverrides {
  id?: number
  goals?: { time: string; scorer: string; score: string; home_away: string }[]
}

function match (overrides: MatchOverrides = {}) {
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
    ...overrides,
  }
}

function fetcherReturning (matches: unknown[]): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { match: matches } }),
  }) as unknown as typeof fetch
}

describe('goal identity', () => {
  beforeEach(() => {
    config.set('dataSource.liveScore.key', 'test-key')
    config.set('dataSource.liveScore.secret', 'test-secret')
    config.set('dataSource.liveScore.competitions', {
      championship: 3, leagueOne: 4, leagueTwo: 5, faCup: 6, leagueCup: 7,
    })
  })

  test('is unaffected by a scorer name correction for the same goal', async () => {
    const original = match({ goals: [{ time: '23', scorer: 'Smith', score: '1 - 0', home_away: 'h' }] })
    const corrected = match({ goals: [{ time: '23', scorer: 'Smyth', score: '1 - 0', home_away: 'h' }] })

    const before = await fetchLiveScoreData(fetcherReturning([original]))
    const after = await fetchLiveScoreData(fetcherReturning([corrected]))

    expect(before.goals[0]!.id).toBe(after.goals[0]!.id)
  })

  test('is unaffected by a stoppage-time minute correction for the same goal', async () => {
    const provisional = match({ goals: [{ time: '45', scorer: 'Fletcher, Ashley', score: '1 - 0', home_away: 'h' }] })
    const confirmed = match({ goals: [{ time: '45+2', scorer: 'Fletcher, Ashley', score: '1 - 0', home_away: 'h' }] })

    const before = await fetchLiveScoreData(fetcherReturning([provisional]))
    const after = await fetchLiveScoreData(fetcherReturning([confirmed]))

    expect(before.goals[0]!.id).toBe(after.goals[0]!.id)
  })

  test('differs between home and away goals in the same match', async () => {
    const m = match({
      goals: [
        { time: '10', scorer: 'Home Scorer', score: '1 - 0', home_away: 'h' },
        { time: '20', scorer: 'Away Scorer', score: '1 - 1', home_away: 'a' },
      ],
    })

    const { goals } = await fetchLiveScoreData(fetcherReturning([m]))

    expect(goals[0]!.id).not.toBe(goals[1]!.id)
  })

  test('increments for a second goal by the same side', async () => {
    const m = match({
      goals: [
        { time: '10', scorer: 'Fletcher, Ashley', score: '1 - 0', home_away: 'h' },
        { time: '50', scorer: 'Fletcher, Ashley', score: '2 - 0', home_away: 'h' },
      ],
    })

    const { goals } = await fetchLiveScoreData(fetcherReturning([m]))

    expect(goals).toHaveLength(2)
    expect(goals[0]!.id).not.toBe(goals[1]!.id)
  })

  test('collapses a literal duplicate goal reported twice in the same snapshot', async () => {
    const m = match({
      goals: [
        { time: '23', scorer: 'Fletcher, Ashley', score: '1 - 0', home_away: 'h' },
        { time: '23', scorer: 'Fletcher, Ashley', score: '1 - 0', home_away: 'h' },
      ],
    })

    const { goals } = await fetchLiveScoreData(fetcherReturning([m]))

    expect(goals).toHaveLength(1)
  })

  test('does not collide ids across different fixtures', async () => {
    const first = match({ id: 1 })
    const second = match({ id: 2 })

    const { goals } = await fetchLiveScoreData(fetcherReturning([first, second]))

    expect(goals).toHaveLength(2)
    expect(goals[0]!.id).not.toBe(goals[1]!.id)
  })

  test('falls back to the positional scheme when the source supplies no event id', async () => {
    const { goals } = await fetchLiveScoreData(fetcherReturning([match()]))

    expect(goals[0]!.id).toBe('1-h-1')
  })
})

describe('goal identity from provider event ids', () => {
  function eventsFetcher (events: Record<string, unknown>[], scoreOverride?: string): typeof fetch {
    const m = { ...match(), goals: [], scores: { score: scoreOverride ?? '2 - 0' }, urls: { events: 'https://example.com/e.json' } }
    return vi.fn(async (url: string) => {
      if (String(url).includes('/events')) {
        return { ok: true, status: 200, json: async () => ({ data: { event: events } }) }
      }
      return { ok: true, status: 200, json: async () => ({ data: { match: [m] } }) }
    }) as unknown as typeof fetch
  }

  const first = { id: 421058736, event: 'GOAL', time: 23, sort: 0, player: { name: 'Fletcher, Ashley' }, is_home: true, is_away: false }
  const second = { id: 421058737, event: 'GOAL', time: 67, sort: 1, player: { name: 'Second, Sam' }, is_home: true, is_away: false }

  beforeEach(() => {
    config.set('dataSource.liveScore.key', 'test-key')
    config.set('dataSource.liveScore.secret', 'test-secret')
    config.set('dataSource.liveScore.competitions', {
      championship: 3, leagueOne: 4, leagueTwo: 5, faCup: 6, leagueCup: 7,
    })
  })

  test('uses the provider event id rather than the goal position', async () => {
    const { goals } = await fetchLiveScoreData(eventsFetcher([first, second]))

    expect(goals.map(g => g.id)).toEqual(['1-421058736', '1-421058737'])
  })

  test('keeps an existing goal id when an earlier goal arrives late and shifts every position', async () => {
    const late = { id: 421058735, event: 'GOAL', time: 5, sort: 0, player: { name: 'Early, Eric' }, is_home: true, is_away: false }

    const before = await fetchLiveScoreData(eventsFetcher([first, second]))
    const after = await fetchLiveScoreData(eventsFetcher([late, first, second], '3 - 0'))

    expect(before.goals.map(g => g.id)).toEqual(['1-421058736', '1-421058737'])
    expect(after.goals.map(g => g.id)).toEqual(['1-421058735', '1-421058736', '1-421058737'])
  })

  test('emits the goals it has while the events list still lags the score', async () => {
    const { goals } = await fetchLiveScoreData(eventsFetcher([first], '2 - 0'))

    expect(goals.map(g => g.id)).toEqual(['1-421058736'])
  })
})
