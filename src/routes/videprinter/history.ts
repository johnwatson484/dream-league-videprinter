import type { ServerRoute } from '@hapi/hapi'
import { eventsStore } from '../../videprinter/state/events-store.ts'
import config from '../../config.ts'
import { fetchRecentEvents } from '../../videprinter/storage/mongo.ts'

const route: ServerRoute = {
  method: 'GET',
  path: '/videprinter/history',
  options: {
    description: 'Return recent videprinter goal events for replay',
    auth: false,
    tags: ['videprinter'],
  },
  handler: async (request, h) => {
    const limitParam = request.query.limit
    const limit = Math.min(Number.parseInt(Array.isArray(limitParam) ? limitParam[0] || '100' : limitParam || '100', 10), 500)
    const mongoCfg = config.get('mongo')
    if (mongoCfg.enabled) {
      const events = await fetchRecentEvents(limit)
      if (Array.isArray(events) && events.length > 0) {
        return { events }
      }
      return { events: eventsStore.list({ limit, order: 'desc' }) }
    }
    return { events: eventsStore.list({ limit, order: 'desc' }) }
  },
}

export default route
