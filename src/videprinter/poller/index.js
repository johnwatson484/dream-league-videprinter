import config from '../../config.js'
import { fetchLiveGoals as fetchMockGoals } from '../fetchers/mock.js'
import { fetchLiveScoreGoals } from '../fetchers/live-score.js'
import { videprinterBroadcaster } from '../state/broadcaster.js'
import { eventsStore } from '../state/events-store.js'
import { saveEvents } from '../storage/mongo.js'
import { remainingRequestsToday } from '../state/request-counter.js'

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
    videprinterBroadcaster.emit('goal', goal)
    eventsStore.add(goal)
    emitted++
  }

  // Save all new goals to MongoDB
  if (goals.length > 0) {
    await saveEvents(goals)
  }

  return emitted
}

export function startPoller (logger = console) {
  const { pollLiveIntervalMs } = config.get('videprinter')
  async function runTickBody () {
    const emitted = await loop()
    const remaining = await remainingRequestsToday()
    logger.log(`[videprinter] poll tick emitted=${emitted} remainingQuota=${remaining}`)
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
