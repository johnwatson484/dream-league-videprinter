import type { GoalEvent } from '../types.ts'
import config from '../../config.ts'
import logger from '../../logger.ts'
import { fetchLiveGoals as fetchMockGoals } from '../fetchers/mock.ts'
import { fetchLiveScoreData } from '../fetchers/live-score.ts'
import { videprinterBroadcaster } from '../state/broadcaster.ts'
import { eventsStore } from '../state/events-store.ts'
import { saveEvents } from '../storage/mongo.ts'
import { saveMatches } from '../storage/match-store.ts'
import { remainingRequestsToday } from '../state/request-counter.ts'
import { dreamLeagueService } from '../matching/dream-league-service.ts'

function isQuietHours (): boolean {
  const { quietHoursStart, quietHoursEnd } = config.get('videprinter')
  const now = new Date()
  const currentHour = now.getHours()

  if (quietHoursStart > quietHoursEnd) {
    return currentHour >= quietHoursStart || currentHour < quietHoursEnd
  } else {
    return currentHour >= quietHoursStart && currentHour < quietHoursEnd
  }
}

async function loop (): Promise<number> {
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

  let emitted = 0
  for (const goal of goals) {
    const enhancedGoal = await dreamLeagueService.enhanceGoal(goal)

    videprinterBroadcaster.emit('goal', enhancedGoal)
    eventsStore.add(enhancedGoal)
    emitted++
  }

  if (goals.length > 0) {
    const enhancedGoals = await Promise.all(
      goals.map(goal => dreamLeagueService.enhanceGoal(goal))
    )
    await saveEvents(enhancedGoals)
  }

  return emitted
}

export function startPoller (): void {
  const { pollLiveIntervalMs } = config.get('videprinter')
  async function runTickBody (): Promise<number> {
    if (isQuietHours()) {
      logger.info('[videprinter] skipping poll during quiet hours')
      return 0
    }

    const emitted = await loop()
    const remaining = await remainingRequestsToday()
    logger.info(`[videprinter] poll tick emitted=${emitted} remainingQuota=${remaining}`)
    return emitted
  }
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
