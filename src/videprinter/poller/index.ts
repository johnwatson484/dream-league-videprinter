import type { GoalEvent } from '../types.ts'
import config from '../../config.ts'
import logger from '../../logger.ts'
import { fetchLiveGoals as fetchMockGoals } from '../fetchers/mock.ts'
import { fetchLiveScoreData, type GoalRetraction } from '../fetchers/live-score.ts'
import { videprinterBroadcaster } from '../state/broadcaster.ts'
import { eventsStore } from '../state/events-store.ts'
import { eventCache } from '../state/event-cache.ts'
import { contentSignatureFor } from '../aggregation/event-signature.ts'
import { saveEvents, retractEvents } from '../storage/mongo.ts'
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

async function enhanceGoals (goals: GoalEvent[]): Promise<GoalEvent[]> {
  const enhanced: GoalEvent[] = []
  for (const goal of goals) {
    enhanced.push(await dreamLeagueService.enhanceGoal(goal))
  }
  return enhanced
}

// The cache gates broadcasts only, never persistence: the fetcher already diffs against
// Mongo, so a goal whose save failed is offered again next poll and retried for free.
function broadcastGoals (goals: GoalEvent[]): number {
  let emitted = 0
  for (const goal of goals) {
    const signature = contentSignatureFor(goal)
    const priorSignature = eventCache.get(goal.id)
    if (priorSignature === signature) { continue }
    const isCorrection = priorSignature !== undefined
    eventCache.set(goal.id, signature)

    videprinterBroadcaster.emit('goal', isCorrection ? { ...goal, correction: true } : goal)
    if (isCorrection) {
      eventsStore.update(goal)
    } else {
      eventsStore.add(goal)
    }
    emitted++
  }
  return emitted
}

async function processRetractions (retractions: GoalRetraction[]): Promise<void> {
  if (!retractions.length) { return }
  for (const { id, fixtureId } of retractions) {
    eventCache.delete(id)
    eventsStore.retract(id)
    videprinterBroadcaster.emit('goal-retracted', { id, fixtureId })
  }
  await retractEvents(retractions.map(r => r.id))
}

export async function runPollCycle (): Promise<number> {
  const { provider } = config.get('dataSource')
  let goals: GoalEvent[] = []
  let retractions: GoalRetraction[] = []
  if (provider === 'mock') {
    goals = await fetchMockGoals()
  } else if (provider === 'live-score') {
    const result = await fetchLiveScoreData()
    goals = result.goals
    retractions = result.retractions
    if (result.matches.length > 0) {
      await saveMatches(result.matches)
    }
  }

  const enhancedGoals = await enhanceGoals(goals)

  if (enhancedGoals.length > 0 && await saveEvents(enhancedGoals) === false) {
    logger.warn(`[videprinter] could not persist ${enhancedGoals.length} goal event(s), retrying next poll`)
  }

  const emitted = broadcastGoals(enhancedGoals)

  await processRetractions(retractions)

  return emitted
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
  let busy = false

  // The next tick is scheduled synchronously and never awaits the poll, so a request or
  // query that hangs can delay a cycle but can no longer stop the loop altogether.
  function tick (): void {
    setTimeout(tick, pollLiveIntervalMs)

    if (busy) {
      logger.error('[videprinter] previous poll still running, skipping this tick')
      return
    }

    busy = true
    runTickBody()
      .catch(err => logger.error({ err }, '[videprinter] poll error'))
      .finally(() => { busy = false })
  }

  tick()
}
