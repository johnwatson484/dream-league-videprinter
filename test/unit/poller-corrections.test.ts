import { vi } from 'vitest'
import type { GoalEvent } from '../../src/videprinter/types.ts'

const { mockFetchLiveScoreData, mockEnhanceGoal, mockSaveEvents, mockSaveMatches, mockRetractEvents } = vi.hoisted(() => ({
  mockFetchLiveScoreData: vi.fn(),
  mockEnhanceGoal: vi.fn(),
  mockSaveEvents: vi.fn(),
  mockSaveMatches: vi.fn(),
  mockRetractEvents: vi.fn(),
}))

vi.mock('../../src/videprinter/fetchers/live-score.ts', () => ({ fetchLiveScoreData: mockFetchLiveScoreData }))
vi.mock('../../src/videprinter/storage/mongo.ts', () => ({ saveEvents: mockSaveEvents, retractEvents: mockRetractEvents }))
vi.mock('../../src/videprinter/storage/match-store.ts', () => ({ saveMatches: mockSaveMatches }))
vi.mock('../../src/videprinter/matching/dream-league-service.ts', () => ({
  dreamLeagueService: { enhanceGoal: mockEnhanceGoal },
}))

const { runPollCycle } = await import('../../src/videprinter/poller/index.ts')
const { eventCache } = await import('../../src/videprinter/state/event-cache.ts')
const { eventsStore } = await import('../../src/videprinter/state/events-store.ts')
const { videprinterBroadcaster } = await import('../../src/videprinter/state/broadcaster.ts')
const config = (await import('../../src/config.ts')).default

function goal (overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: '1-h-1',
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
    source: 'live-score',
    ...overrides,
  }
}

describe('poll cycle: corrections and retractions', () => {
  let goalBroadcasts: GoalEvent[]
  let retractedBroadcasts: { id: string; fixtureId: string }[]

  beforeEach(() => {
    config.set('dataSource.provider', 'live-score')
    eventCache.clear()
    eventsStore.clear()
    goalBroadcasts = []
    retractedBroadcasts = []
    videprinterBroadcaster.removeAllListeners('goal')
    videprinterBroadcaster.removeAllListeners('goal-retracted')
    videprinterBroadcaster.on('goal', (event: GoalEvent) => goalBroadcasts.push(event))
    videprinterBroadcaster.on('goal-retracted', (event: { id: string; fixtureId: string }) => retractedBroadcasts.push(event))
    mockEnhanceGoal.mockImplementation(async (g: GoalEvent) => ({ ...g }))
    mockFetchLiveScoreData.mockReset()
    mockSaveEvents.mockReset()
    mockSaveMatches.mockReset()
    mockRetractEvents.mockReset()
  })

  test('broadcasts a scorer correction for the same id without duplicating it', async () => {
    mockFetchLiveScoreData.mockResolvedValueOnce({ goals: [goal({ scorer: { name: 'Smith', normalizedName: 'smith' } })], matches: [], retractions: [] })
    mockFetchLiveScoreData.mockResolvedValueOnce({ goals: [goal({ scorer: { name: 'Smyth', normalizedName: 'smyth' } })], matches: [], retractions: [] })

    const first = await runPollCycle()
    const second = await runPollCycle()

    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(goalBroadcasts).toHaveLength(2)
    expect(goalBroadcasts[0]!.id).toBe(goalBroadcasts[1]!.id)
    expect((goalBroadcasts[1] as GoalEvent & { correction?: boolean }).correction).toBe(true)
    expect((goalBroadcasts[0] as GoalEvent & { correction?: boolean }).correction).toBeUndefined()
  })

  test('does not rebroadcast when the same content is received twice', async () => {
    mockFetchLiveScoreData.mockResolvedValue({ goals: [goal()], matches: [], retractions: [] })

    await runPollCycle()
    const second = await runPollCycle()

    expect(second).toBe(0)
    expect(goalBroadcasts).toHaveLength(1)
  })

  test('retracts a goal that disappears from a later poll and reflects it in the events store', async () => {
    mockFetchLiveScoreData.mockResolvedValueOnce({ goals: [goal()], matches: [], retractions: [] })
    await runPollCycle()

    mockFetchLiveScoreData.mockResolvedValueOnce({ goals: [], matches: [], retractions: [{ id: '1-h-1', fixtureId: '1' }] })
    await runPollCycle()

    expect(retractedBroadcasts).toEqual([{ id: '1-h-1', fixtureId: '1' }])
    expect(mockRetractEvents).toHaveBeenCalledWith(['1-h-1'])
    expect(eventsStore.all().find(e => e.id === '1-h-1')).toBeUndefined()
  })

  test('saves matches when provided', async () => {
    mockFetchLiveScoreData.mockResolvedValueOnce({ goals: [], matches: [{ fixtureId: '1' }], retractions: [] })

    await runPollCycle()

    expect(mockSaveMatches).toHaveBeenCalledWith([{ fixtureId: '1' }])
  })
})
