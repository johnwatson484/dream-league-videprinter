import { vi } from 'vitest'
import type { GoalEvent } from '../../src/videprinter/types.ts'

const { mockFetchDreamLeagueTeams } = vi.hoisted(() => ({ mockFetchDreamLeagueTeams: vi.fn() }))

vi.mock('../../src/videprinter/fetchers/dream-league.ts', () => ({
  fetchDreamLeagueTeams: mockFetchDreamLeagueTeams,
  clearCache: vi.fn(),
}))

const { dreamLeagueService } = await import('../../src/videprinter/matching/dream-league-service.ts')
const { eventsStore } = await import('../../src/videprinter/state/events-store.ts')
const { rematchAllEvents } = await import('../../src/videprinter/matching/rematch.ts')

function goal (overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: '1',
    fixtureId: '1',
    competition: 'Test',
    utcTimestamp: new Date(),
    minute: 1,
    scoringTeam: { name: 'Blackpool' },
    concedingTeam: { name: 'Luton Town' },
    scorer: { name: 'Fletcher, Ashley', normalizedName: 'fletcher ashley' },
    assist: null,
    scoreAfterEvent: { home: 1, away: 0 },
    phase: 'LIVE',
    source: 'test',
    ...overrides,
  }
}

describe('rematchAllEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventsStore.events = []
    dreamLeagueService.lastUpdateTime = 0
  })

  test('matches a goal to the correct player after the teamsheet is refreshed', async () => {
    mockFetchDreamLeagueTeams.mockResolvedValue({
      players: [{ playerId: 282, name: 'Fletcher, Ashley', position: 'Forward', team: 'Blackpool', managerId: 1, manager: 'Billy Gordon', substitute: false }],
      goalkeepers: [],
    })

    const staleEvent = goal({
      potentialGoalFor: { managerId: 99, manager: 'Wrong Manager', player: 'Wrong Player', playerId: 1, team: 'Blackpool', confidence: 0.5, substitute: false },
    })
    eventsStore.add(staleEvent)

    const summary = await rematchAllEvents()

    expect(summary.eventsProcessed).toBe(1)
    expect(summary.eventsChanged).toBe(1)
    expect(summary.unmatched).toBe(0)
    expect(eventsStore.list()[0]!.potentialGoalFor?.playerId).toBe(282)
  })

  test('clears a stale match when the goal no longer matches anyone', async () => {
    mockFetchDreamLeagueTeams.mockResolvedValue({ players: [], goalkeepers: [] })

    const staleEvent = goal({
      potentialGoalFor: { managerId: 1, manager: 'Billy Gordon', player: 'Fletcher, Ashley', playerId: 282, team: 'Blackpool', confidence: 0.9, substitute: false },
    })
    eventsStore.add(staleEvent)

    const summary = await rematchAllEvents()

    expect(summary.eventsChanged).toBe(1)
    expect(summary.unmatched).toBe(1)
    expect(eventsStore.list()[0]!.potentialGoalFor).toBeUndefined()
  })

  test('reports no changes when the match is still correct', async () => {
    mockFetchDreamLeagueTeams.mockResolvedValue({
      players: [{ playerId: 282, name: 'Fletcher, Ashley', position: 'Forward', team: 'Blackpool', managerId: 1, manager: 'Billy Gordon', substitute: false }],
      goalkeepers: [],
    })

    const event = goal({
      potentialGoalFor: { managerId: 1, manager: 'Billy Gordon', player: 'Fletcher, Ashley', playerId: 282, team: 'Blackpool', confidence: 0.9, substitute: false },
    })
    eventsStore.add(event)

    const summary = await rematchAllEvents()

    expect(summary.eventsChanged).toBe(0)
    expect(summary.unmatched).toBe(0)
  })
})
