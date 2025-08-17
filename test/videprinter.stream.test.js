import { createServer } from '../src/server.js'

describe('videprinter stream', () => {
  test('connects and receives events (mock provider)', async () => {
    const server = await createServer()
    const res = await server.inject({ method: 'GET', url: '/videprinter/stream' })
    expect(res.statusCode).toBe(200)
    expect(res.rawPayload.toString()).toContain('connected')
  })
})
