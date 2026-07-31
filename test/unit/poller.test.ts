import { vi } from 'vitest'
import type { GoalEvent } from '../../src/videprinter/types.ts'

const { mockFetchMock, mockEnhanceGoal, mockSaveEvents } = vi.hoisted(() => ({
  mockFetchMock: vi.fn(),
  mockEnhanceGoal: vi.fn(),
  mockSaveEvents: vi.fn()
}))

vi.mock('../../src/videprinter/fetchers/mock.ts', () => ({ fetchLiveGoals: mockFetchMock }))
vi.mock('../../src/videprinter/storage/mongo.ts', () => ({ saveEvents: mockSaveEvents }))
vi.mock('../../src/videprinter/matching/dream-league-service.ts', () => ({
  dreamLeagueService: { enhanceGoal: mockEnhanceGoal }
}))

const { runPollCycle } = await import('../../src/videprinter/poller/index.ts')
const { eventCache } = await import('../../src/videprinter/state/event-cache.ts')
const { videprinterBroadcaster } = await import('../../src/videprinter/state/broadcaster.ts')

function goal (id: string): GoalEvent {
  return {
    id,
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
    source: 'mock'
  }
}

describe('poll cycle', () => {
  let broadcast: GoalEvent[]

  beforeEach(() => {
    eventCache.clear()
    broadcast = []
    videprinterBroadcaster.removeAllListeners('goal')
    videprinterBroadcaster.on('goal', (event: GoalEvent) => broadcast.push(event))
    mockEnhanceGoal.mockImplementation(async (g: GoalEvent) => ({ ...g }))
  })

  test('broadcasts each new goal once', async () => {
    mockFetchMock.mockResolvedValue([goal('a'), goal('b')])

    const emitted = await runPollCycle()

    expect(emitted).toBe(2)
    expect(broadcast.map(e => e.id)).toEqual(['a', 'b'])
  })

  test('does not rebroadcast a goal seen on an earlier tick', async () => {
    mockFetchMock.mockResolvedValue([goal('a')])

    await runPollCycle()
    const emitted = await runPollCycle()

    expect(emitted).toBe(0)
    expect(broadcast).toHaveLength(1)
  })

  test('filters duplicates within a single tick', async () => {
    mockFetchMock.mockResolvedValue([goal('a'), goal('a')])

    const emitted = await runPollCycle()

    expect(emitted).toBe(1)
  })

  test('enhances each goal exactly once', async () => {
    mockFetchMock.mockResolvedValue([goal('a'), goal('b')])

    await runPollCycle()

    expect(mockEnhanceGoal).toHaveBeenCalledTimes(2)
  })

  test('persists the same enhanced events that were broadcast', async () => {
    mockFetchMock.mockResolvedValue([goal('a')])

    await runPollCycle()

    expect(mockSaveEvents).toHaveBeenCalledTimes(1)
    expect(mockSaveEvents.mock.calls[0]![0]).toEqual(broadcast)
  })

  test('does not touch storage when there are no goals', async () => {
    mockFetchMock.mockResolvedValue([])

    await runPollCycle()

    expect(mockSaveEvents).not.toHaveBeenCalled()
  })
})
