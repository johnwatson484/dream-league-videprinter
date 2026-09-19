import { vi } from 'vitest'

const { noteExternalRequest, canMakeExternalRequest, remainingRequestsToday } = await import('../../src/videprinter/state/request-counter.ts')
const config = (await import('../../src/config.ts')).default

describe('daily request counter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    config.set('dataSource.dailyRequestCap', 10000)
  })

  test('stops allowing requests once the cap is reached', async () => {
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'))
    config.set('dataSource.dailyRequestCap', 2)

    await noteExternalRequest()
    await noteExternalRequest()

    expect(await canMakeExternalRequest()).toBe(false)
    expect(await remainingRequestsToday()).toBe(0)
  })

  // The cap check is the only entry point still reachable once the budget is spent, so if
  // it did not roll the day the counter would stay stuck on a spent day indefinitely.
  test('starts a fresh budget the next day even though the cap was reached', async () => {
    vi.setSystemTime(new Date('2030-02-01T12:00:00Z'))
    config.set('dataSource.dailyRequestCap', 2)

    await noteExternalRequest()
    await noteExternalRequest()
    expect(await canMakeExternalRequest()).toBe(false)

    vi.setSystemTime(new Date('2030-02-02T09:00:00Z'))

    expect(await canMakeExternalRequest()).toBe(true)
    expect(await remainingRequestsToday()).toBe(2)
  })

  test('does not reset the count when the day has not changed', async () => {
    vi.setSystemTime(new Date('2030-03-01T09:00:00Z'))
    config.set('dataSource.dailyRequestCap', 10)

    await noteExternalRequest()
    expect(await canMakeExternalRequest()).toBe(true)

    vi.setSystemTime(new Date('2030-03-01T22:00:00Z'))

    expect(await remainingRequestsToday()).toBe(9)
  })
})
