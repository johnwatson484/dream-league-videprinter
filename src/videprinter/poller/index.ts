import type { GoalEvent } from '../types.ts'
import config from '../../config.ts'
import logger from '../../logger.ts'
import { fetchLiveGoals as fetchMockGoals } from '../fetchers/mock.ts'
import { fetchLiveScoreData } from '../fetchers/live-score.ts'
import { videprinterBroadcaster } from '../state/broadcaster.ts'
import { eventsStore } from '../state/events-store.ts'
import { eventCache } from '../state/event-cache.ts'
import { saveEvents } from '../storage/mongo.ts'
import { saveMatches } from '../storage/match-store.ts'
import { remainingRequestsToday } from '../state/request-counter.ts'
import { dreamLeagueService } from '../matching/dream-league-service.ts'

export function isQuietHours (now: Date = new Date()): boolean {
  const { quietHoursStart, quietHoursEnd, timezone } = config.get('videprinter')
  const currentHour = hourIn(timezone, now)

  if (quietHoursStart > quietHoursEnd) {
    return currentHour >= quietHoursStart || currentHour < quietHoursEnd
  } else {
    return currentHour >= quietHoursStart && currentHour < quietHoursEnd
  }
}

// The host clock is UTC in production, so read the hour in the league's own timezone
// or the window drifts by an hour over British Summer Time.
function hourIn (timezone: string, now: Date): number {
  try {
    // h23 rather than hour12:false, which reports midnight as 24 in some locales.
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(now)
    return Number.parseInt(hour, 10)
  } catch {
    logger.warn(`[videprinter] unknown timezone ${timezone}, falling back to host time`)
    return now.getHours()
  }
}

export async function runPollCycle (): Promise<number> {
  const { provider } = config.get('dataSource')
  let goals: GoalEvent[] = []
  if (provider === 'mock') {
    goals = await fetchMockGoals()
  } else if (provider === 'live-score') {
    const result = await fetchLiveScoreData()
    goals = result.goals
    if (result.matches.length > 0) {
      await saveMatches(result.matches)
    }
  }

  const enhancedGoals: GoalEvent[] = []
  for (const goal of goals) {
    // Mongo dedupes on read, but it is optional, so guard broadcasts in process too.
    if (eventCache.has(goal.id)) { continue }
    eventCache.add(goal.id)

    const enhancedGoal = await dreamLeagueService.enhanceGoal(goal)

    videprinterBroadcaster.emit('goal', enhancedGoal)
    eventsStore.add(enhancedGoal)
    enhancedGoals.push(enhancedGoal)
  }

  if (enhancedGoals.length > 0) {
    await saveEvents(enhancedGoals)
  }

  return enhancedGoals.length
}

async function runTickBody (): Promise<number> {
  if (isQuietHours()) {
    logger.info('[videprinter] skipping poll during quiet hours')
    return 0
  }

  const emitted = await runPollCycle()
  const remaining = await remainingRequestsToday()
  logger.info(`[videprinter] poll tick emitted=${emitted} remainingQuota=${remaining}`)
  return emitted
}

export function startPoller (): void {
  const { pollLiveIntervalMs } = config.get('videprinter')
  async function tick (): Promise<void> {
    try {
      await runTickBody()
    } catch (err) {
      logger.error({ err }, '[videprinter] poll error')
    } finally {
      setTimeout(tick, pollLiveIntervalMs)
    }
  }
  tick()
}
