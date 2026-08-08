import type { GoalEvent } from '../../src/videprinter/types.ts'
import { createServer } from '../../src/server.ts'
import { eventsStore } from '../../src/videprinter/state/events-store.ts'

describe('videprinter history', () => {
  test('returns recent events', async () => {
    const server = await createServer()
    eventsStore.add({ id: '1', fixtureId: '1', competition: 'Test', utcTimestamp: new Date(), minute: 1, scoringTeam: { name: 'A' }, concedingTeam: { name: 'B' }, scorer: { name: 'X', normalizedName: 'x' }, assist: null, scoreAfterEvent: { home: 1, away: 0 }, phase: 'LIVE', source: 'test' } satisfies GoalEvent)
    const res = await server.inject({ method: 'GET', url: '/videprinter/history?limit=10' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events.length).toBeGreaterThan(0)
  })

  test('filters events by date range when from and to are provided', async () => {
    const server = await createServer()
    eventsStore.add({ id: 'in-range', fixtureId: 'f1', competition: 'Test', utcTimestamp: new Date('2026-08-05T12:00:00.000Z'), minute: 10, scoringTeam: { name: 'A' }, concedingTeam: { name: 'B' }, scorer: { name: 'X', normalizedName: 'x' }, assist: null, scoreAfterEvent: { home: 1, away: 0 }, phase: 'LIVE', source: 'test' } satisfies GoalEvent)
    eventsStore.add({ id: 'out-of-range', fixtureId: 'f2', competition: 'Test', utcTimestamp: new Date('2026-07-01T12:00:00.000Z'), minute: 20, scoringTeam: { name: 'A' }, concedingTeam: { name: 'B' }, scorer: { name: 'Y', normalizedName: 'y' }, assist: null, scoreAfterEvent: { home: 1, away: 0 }, phase: 'LIVE', source: 'test' } satisfies GoalEvent)

    const res = await server.inject({ method: 'GET', url: '/videprinter/history?from=2026-08-01T00:00:00.000Z&to=2026-08-08T23:59:59.999Z' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    const ids = body.events.map((e: GoalEvent) => e.id)
    expect(ids).toContain('in-range')
    expect(ids).not.toContain('out-of-range')
  })

  test('falls back to limit-based history when only one of from/to is provided', async () => {
    const server = await createServer()
    const res = await server.inject({ method: 'GET', url: '/videprinter/history?limit=10&from=2026-08-01T00:00:00.000Z' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(Array.isArray(body.events)).toBe(true)
  })
})
