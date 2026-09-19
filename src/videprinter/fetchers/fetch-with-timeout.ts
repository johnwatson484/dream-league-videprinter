import config from '../../config.ts'

// A request that is accepted and then never answered leaves the poll cycle's `await`
// unsettled, so the tick loop never reaches its `finally` and stops rescheduling for good.
export async function fetchWithTimeout (fetcher: typeof fetch, url: string): Promise<Response> {
  const timeoutMs = config.get('dataSource').requestTimeoutMs
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
