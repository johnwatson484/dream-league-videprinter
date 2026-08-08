import { createServer } from '../../src/server.ts'

describe('videprinter rematch', () => {
  test('rejects requests without an api key', async () => {
    const server = await createServer()
    const res = await server.inject({ method: 'POST', url: '/videprinter/rematch' })
    expect(res.statusCode).toBe(401)
  })

  test('rejects requests with the wrong api key', async () => {
    const server = await createServer()
    const res = await server.inject({ method: 'POST', url: '/videprinter/rematch', headers: { 'x-api-key': 'wrong-key' } })
    expect(res.statusCode).toBe(401)
  })

  test('accepts requests with the correct api key', async () => {
    const server = await createServer()
    const res = await server.inject({ method: 'POST', url: '/videprinter/rematch', headers: { 'x-api-key': process.env.API_KEY! } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body).toHaveProperty('eventsProcessed')
  })
})
