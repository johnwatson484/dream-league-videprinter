import { eventsStore } from '../../videprinter/state/events-store.js'
import config from '../../config.js'
import { fetchRecentEvents } from '../../videprinter/storage/mongo.js'

const route = {
  method: 'GET',
  path: '/videprinter/history',
  options: {
    description: 'Return recent videprinter goal events for replay',
    auth: false,
    tags: ['videprinter'],
  },
  handler: async (request, h) => {
    const limit = Math.min(parseInt(request.query.limit || '100', 10), 500)
    const mongoCfg = config.get('mongo')
    if (mongoCfg.enabled) {
      const events = await fetchRecentEvents(limit)
      return { events }
    }
    return { events: eventsStore.list({ limit, order: 'desc' }) }
  },
}

export default route
