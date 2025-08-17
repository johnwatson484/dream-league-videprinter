import { createServer } from '../src/server.js'
import { eventsStore } from '../src/videprinter/state/events-store.js'

describe('videprinter history', () => {
  test('returns recent events', async () => {
    const server = await createServer()
    eventsStore.add({ id: '1', scoringTeam: { name: 'A' }, concedingTeam: { name: 'B' }, scorer: { name: 'X' }, minute: 1 })
    const res = await server.inject({ method: 'GET', url: '/videprinter/history?limit=10' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events.length).toBeGreaterThan(0)
  })
})
