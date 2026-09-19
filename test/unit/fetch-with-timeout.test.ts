import { vi } from 'vitest'

const { fetchWithTimeout } = await import('../../src/videprinter/fetchers/fetch-with-timeout.ts')
const config = (await import('../../src/config.ts')).default

describe('fetchWithTimeout', () => {
  afterEach(() => {
    config.set('dataSource.requestTimeoutMs', 10000)
  })

  // Without the abort this promise never settles, which is what stops the poll loop
  // rescheduling at all.
  test('aborts a request that is accepted but never answered', async () => {
    config.set('dataSource.requestTimeoutMs', 10)
    const fetcher = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')))
    }))

    await expect(fetchWithTimeout(fetcher as unknown as typeof fetch, 'https://example.com/live.json'))
      .rejects.toThrow('aborted')
  })

  test('passes a response straight through when the request answers in time', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 })

    const res = await fetchWithTimeout(fetcher as unknown as typeof fetch, 'https://example.com/live.json')

    expect(res.status).toBe(200)
  })
})
