import config from '../../config.js'
import { fetchLiveGoals as fetchMockGoals } from '../fetchers/mock.js'
import { fetchLiveScoreGoals } from '../fetchers/live-score.js'
import { eventCache } from '../state/event-cache.js'
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

  let emitted = 0
  for (const goal of goals) {
    if (!eventCache.has(goal.id)) {
      eventCache.add(goal.id); videprinterBroadcaster.emit('goal', goal); eventsStore.add(goal); emitted++
    }
  }
  if (emitted > 0) {
    await saveEvents(goals.filter(g => eventCache.has(g.id)))
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
