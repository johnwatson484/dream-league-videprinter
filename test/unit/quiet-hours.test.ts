import { vi } from 'vitest'

vi.mock('../../src/videprinter/fetchers/mock.ts', () => ({ fetchLiveGoals: vi.fn() }))
vi.mock('../../src/videprinter/storage/mongo.ts', () => ({ saveEvents: vi.fn() }))
vi.mock('../../src/videprinter/matching/dream-league-service.ts', () => ({
  dreamLeagueService: { enhanceGoal: vi.fn() }
}))

const { isQuietHours } = await import('../../src/videprinter/poller/index.ts')
const config = (await import('../../src/config.ts')).default

describe('quiet hours', () => {
  const start = config.get('videprinter').quietHoursStart
  const end = config.get('videprinter').quietHoursEnd
  const timezone = config.get('videprinter').timezone

  afterEach(() => {
    config.set('videprinter.quietHoursStart', start)
    config.set('videprinter.quietHoursEnd', end)
    config.set('videprinter.timezone', timezone)
  })

  test('defaults to the league timezone', () => {
    expect(config.get('videprinter').timezone).toBe('Europe/London')
  })

  test('uses local time rather than the host clock during British Summer Time', () => {
    // 22:30 UTC in July is 23:30 in London, so quiet hours have started.
    expect(isQuietHours(new Date('2026-07-31T22:30:00Z'))).toBe(true)
    expect(isQuietHours(new Date('2026-07-31T21:30:00Z'))).toBe(false)
  })

  test('uses local time in winter when London is UTC', () => {
    expect(isQuietHours(new Date('2026-01-15T22:30:00Z'))).toBe(false)
    expect(isQuietHours(new Date('2026-01-15T23:30:00Z'))).toBe(true)
  })

  test('resumes polling at the end of the quiet window', () => {
    // 10:30 UTC in July is 11:30 in London, so polling has resumed.
    expect(isQuietHours(new Date('2026-07-31T10:30:00Z'))).toBe(false)
    expect(isQuietHours(new Date('2026-07-31T09:30:00Z'))).toBe(true)
  })

  test('treats midnight as hour zero rather than twenty four', () => {
    config.set('videprinter.quietHoursStart', 1)
    config.set('videprinter.quietHoursEnd', 2)

    expect(isQuietHours(new Date('2026-01-15T00:30:00Z'))).toBe(false)
  })

  test('handles a window that does not wrap midnight', () => {
    config.set('videprinter.quietHoursStart', 2)
    config.set('videprinter.quietHoursEnd', 5)

    expect(isQuietHours(new Date('2026-01-15T03:00:00Z'))).toBe(true)
    expect(isQuietHours(new Date('2026-01-15T06:00:00Z'))).toBe(false)
  })

  test('reads the hour in the configured timezone, not the host clock', () => {
    const instant = new Date('2026-07-31T18:00:00Z')

    config.set('videprinter.timezone', 'Asia/Tokyo') // 03:00 the next day
    expect(isQuietHours(instant)).toBe(true)

    config.set('videprinter.timezone', 'America/Los_Angeles') // 11:00 the same day
    expect(isQuietHours(instant)).toBe(false)
  })

  test('falls back to host time for an unknown timezone', () => {
    config.set('videprinter.timezone', 'Not/AZone')

    expect(() => isQuietHours(new Date('2026-07-31T22:30:00Z'))).not.toThrow()
  })
})
