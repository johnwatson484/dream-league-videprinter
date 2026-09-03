import { vi } from 'vitest'
import type { GoalEvent } from '../../src/videprinter/types.ts'

const mockBulkWrite = vi.fn().mockResolvedValue({})
const mockCollection = {
  bulkWrite: mockBulkWrite,
  createIndex: vi.fn().mockResolvedValue(undefined),
  indexExists: vi.fn().mockResolvedValue(false),
  dropIndex: vi.fn().mockResolvedValue(undefined),
}
const mockDb = { collection: vi.fn().mockReturnValue(mockCollection) }

vi.mock('mongodb', () => ({
  MongoClient: vi.fn().mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      db: vi.fn().mockReturnValue(mockDb),
    }
  }),
}))
vi.mock('../../src/videprinter/storage/meta-store.ts', () => ({ registerMetaCollection: vi.fn() }))
vi.mock('../../src/videprinter/storage/match-store.ts', () => ({ initMatchCollection: vi.fn().mockResolvedValue(undefined) }))

const { initMongo, saveEvents } = await import('../../src/videprinter/storage/mongo.ts')
const config = (await import('../../src/config.ts')).default

function goal (overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
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
    ...overrides
  }
}

describe('saveEvents clears a stale retraction', () => {
  beforeAll(async () => {
    config.set('mongo.enabled', true)
    config.set('mongo.uri', 'mongodb://fake')
    await initMongo()
  })

  test('always clears retracted/retractedAt for every event it (re)saves', async () => {
    await saveEvents([goal()])

    expect(mockBulkWrite).toHaveBeenCalledTimes(1)
    const ops = mockBulkWrite.mock.calls[0]![0] as any[]
    expect(ops).toHaveLength(1)
    expect(ops[0].updateOne.update.$set).toMatchObject({ retracted: false, retractedAt: null })
  })
})
