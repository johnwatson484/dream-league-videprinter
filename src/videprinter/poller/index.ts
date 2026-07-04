import config from '../../config.ts'
import { fetchLiveGoals as fetchMockGoals } from '../fetchers/mock.ts'
import { fetchLiveScoreGoals } from '../fetchers/live-score.ts'
import { videprinterBroadcaster } from '../state/broadcaster.ts'
import { eventsStore } from '../state/events-store.ts'
import { saveEvents } from '../storage/mongo.ts'
import { remainingRequestsToday } from '../state/request-counter.ts'
import { dreamLeagueService } from '../matching/dream-league-service.ts'

function isQuietHours () {
  const { quietHoursStart, quietHoursEnd } = config.get('videprinter')
  const now = new Date()
  const currentHour = now.getHours()

  // Handle cases where quiet period crosses midnight (e.g., 23 to 12)
  if (quietHoursStart > quietHoursEnd) {
    // Crosses midnight: quiet if hour >= start OR hour < end
    return currentHour >= quietHoursStart || currentHour < quietHoursEnd
  } else {
    // Same day: quiet if hour >= start AND hour < end
    return currentHour >= quietHoursStart && currentHour < quietHoursEnd
  }
}

async function loop () {
  const { provider } = config.get('dataSource')
  let goals = []
  if (provider === 'mock') {
    goals = await fetchMockGoals()
  } else if (provider === 'live-score') {
    goals = await fetchLiveScoreGoals()
  }

  // Goals are already deduplicated by the fetcher using MongoDB
  let emitted = 0
  for (const goal of goals) {
    // Enhance goal with Dream League Fantasy Football data
    const enhancedGoal = await dreamLeagueService.enhanceGoal(goal)

    videprinterBroadcaster.emit('goal', enhancedGoal)
    eventsStore.add(enhancedGoal)
    emitted++
  }

  // Save all new goals to MongoDB
  if (goals.length > 0) {
    // Enhance goals before saving
    const enhancedGoals = await Promise.all(
      goals.map(goal => dreamLeagueService.enhanceGoal(goal))
    )
    await saveEvents(enhancedGoals)
  }

  return emitted
}

export function startPoller (logger = console) {
  const { pollLiveIntervalMs } = config.get('videprinter')
  async function runTickBody () {
    if (isQuietHours()) {
      logger.log('[videprinter] skipping poll during quiet hours')
      return 0
    }

    const emitted = await loop()
    const remaining = await remainingRequestsToday()
    logger.log(`[videprinter] poll tick emitted=${emitted} remainingQuota=${remaining}`)
    return emitted
  }
  async function tick () {
    try {
      await runTickBody()
    } catch (err) {
      logger.error('[videprinter] poll error', err)
    } finally {
      setTimeout(tick, pollLiveIntervalMs)
    }
  }
  tick()
}
