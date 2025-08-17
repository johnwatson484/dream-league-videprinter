import { createServer } from '../src/server.js'

describe('assets css', () => {
  test('serves videprinter.css with text/css mime', async () => {
    const server = await createServer()
    const res = await server.inject({ method: 'GET', url: '/assets/css/videprinter.css' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/css/)
    expect(res.payload).toContain('.videprinter')
  })
})
