import config from '../../config.ts'

// Undici sends no descriptive User-Agent and no Accept by default; some provider edges
// stall rather than reject such requests, which surfaces here only as an abort.
const DEFAULT_HEADERS = {
  'user-agent': 'dream-league-videprinter/1.0',
  accept: 'application/json',
}

// A request that is accepted and then never answered leaves the poll cycle's `await`
// unsettled, so the tick loop never reaches its `finally` and stops rescheduling for good.
export async function fetchWithTimeout (fetcher: typeof fetch, url: string): Promise<Response> {
  const timeoutMs = config.get('dataSource').requestTimeoutMs
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, { signal: controller.signal, headers: DEFAULT_HEADERS })
  } finally {
    clearTimeout(timer)
  }
}
