import { createServer } from '../src/server.js'

describe('home test', () => {
  let server

  beforeEach(async () => {
    server = await createServer()
    await server.initialize()
  })

  test('GET /home route redirects to /live-scores', async () => {
    const options = {
      method: 'GET',
      url: '/',
    }
    const response = await server.inject(options)
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/live-scores')
  })

  afterEach(async () => {
    await server.stop()
  })
})
