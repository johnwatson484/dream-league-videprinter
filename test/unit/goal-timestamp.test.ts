import { vi } from 'vitest'

vi.mock('../../src/videprinter/state/request-counter.ts', () => ({
  canMakeExternalRequest: vi.fn().mockResolvedValue(true),
  noteExternalRequest: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../../src/videprinter/storage/mongo.ts', () => ({
  fetchActiveEventsForFixture: vi.fn().mockResolvedValue([]),
}))

const { fetchLiveScoreData } = await import('../../src/videprinter/fetchers/live-score.ts')
const config = (await import('../../src/config.ts')).default

interface MatchOverrides {
  id?: number
  status?: string
  scheduled?: string | undefined
  added?: string | undefined
  scores?: { score: string }
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

describe('goal timestamps', () => {
  beforeEach(() => {
    config.set('dataSource.liveScore.key', 'test-key')
    config.set('dataSource.liveScore.secret', 'test-secret')
    config.set('dataSource.liveScore.competitions', {
      championship: 3, leagueOne: 4, leagueTwo: 5, faCup: 6, leagueCup: 7
    })
  })

  test('derives the timestamp from kick-off plus the match minute', async () => {
    const { goals } = await fetchLiveScoreData(fetcherReturning([match()]))

    expect(goals).toHaveLength(1)
    expect(goals[0]!.utcTimestamp.toISOString()).toBe('2026-08-15T15:23:00.000Z')
  })

  test('records the kick-off as the match timestamp', async () => {
    const { matches } = await fetchLiveScoreData(fetcherReturning([match()]))

    expect(matches[0]!.utcTimestamp.toISOString()).toBe('2026-08-15T15:00:00.000Z')
  })

  test('rolls into the next day for a kick-off just after midnight', async () => {
    const late = match({ scheduled: '00:15', added: '2026-08-15 23:50:00' })

    const { goals } = await fetchLiveScoreData(fetcherReturning([late]))

    // Kick-off 00:15 on the 16th plus the 23rd minute.
    expect(goals[0]!.utcTimestamp.toISOString()).toBe('2026-08-16T00:38:00.000Z')
  })

  test('orders goals across matches with different kick-offs', async () => {
    const early = match({
      id: 1,
      scheduled: '12:30',
      added: '2026-08-15 12:15:00',
      goals: [{ time: '80', scorer: 'Early, Sam', score: '1 - 0', home_away: 'h' }]
    })
    const late = match({
      id: 2,
      scheduled: '15:00',
      added: '2026-08-15 14:45:00',
      goals: [{ time: '5', scorer: 'Late, Joe', score: '1 - 0', home_away: 'h' }]
    })

    const { goals } = await fetchLiveScoreData(fetcherReturning([late, early]))

    // 12:30 + 80 = 13:50 came before 15:00 + 5 = 15:05, despite the fetch order.
    expect(goals.map(g => g.scorer.name)).toEqual(['Early, Sam', 'Late, Joe'])
  })

  test('falls back to ingest time when the match has no schedule', async () => {
    const undated = match({ scheduled: undefined, added: undefined })

    const before = Date.now()
    const { goals } = await fetchLiveScoreData(fetcherReturning([undated]))

    expect(goals[0]!.utcTimestamp.getTime()).toBeGreaterThanOrEqual(before)
  })

  test('falls back to ingest time when the minute is unknown', async () => {
    const noMinute = match({
      goals: [{ time: '', scorer: 'Fletcher, Ashley', score: '1 - 0', home_away: 'h' }]
    })

    const before = Date.now()
    const { goals } = await fetchLiveScoreData(fetcherReturning([noMinute]))

    expect(goals[0]!.minute).toBeNull()
    expect(goals[0]!.utcTimestamp.getTime()).toBeGreaterThanOrEqual(before)
  })

  test('excludes penalty shootout kicks reported at minute 120, even though the score keeps climbing normally', async () => {
    const wentToPenalties = match({
      status: 'FINISHED',
      scores: { score: '1 - 1' },
      goals: [
        { time: '23', scorer: 'Fletcher, Ashley', score: '1 - 0', home_away: 'h' },
        { time: '67', scorer: 'Doyle, Eoin', score: '1 - 1', home_away: 'a' },
        { time: '120', scorer: 'Fletcher, Ashley', score: '1 - 2', home_away: 'h' },
        { time: '120', scorer: 'Doyle, Eoin', score: '2 - 2', home_away: 'a' }
      ]
    })

    const { goals } = await fetchLiveScoreData(fetcherReturning([wentToPenalties]))

    expect(goals).toHaveLength(2)
    expect(goals.map(g => g.scoreAfterEvent)).toEqual([{ home: 1, away: 0 }, { home: 1, away: 1 }])
  })
})
