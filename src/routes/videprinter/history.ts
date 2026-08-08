import type { ServerRoute } from '@hapi/hapi'
import { eventsStore } from '../../videprinter/state/events-store.ts'
import config from '../../config.ts'
import { fetchRecentEvents, fetchEventsByDateRange } from '../../videprinter/storage/mongo.ts'

function parseDate (value: unknown): Date | null {
  if (typeof value !== 'string' || !value) { return null }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const route: ServerRoute = {
  method: 'GET',
  path: '/videprinter/history',
  options: {
    description: 'Return recent videprinter goal events for replay, optionally scoped to a from/to date range',
    auth: false,
    cors: true,
    tags: ['videprinter'],
  },
  handler: async (request, h) => {
    const limitParam = request.query.limit
    const limit = Math.min(Number.parseInt(Array.isArray(limitParam) ? limitParam[0] || '100' : limitParam || '100', 10), 500)
    const mongoCfg = config.get('mongo')

    const { from, to } = request.query as { from?: string; to?: string }
    const fromDate = parseDate(from)
    const toDate = parseDate(to)

    if (fromDate && toDate) {
      const events = mongoCfg.enabled
        ? await fetchEventsByDateRange(fromDate, toDate)
        : eventsStore.list({ limit: 500, order: 'desc' }).filter(e => {
          const ts = new Date(e.utcTimestamp)
          return ts >= fromDate && ts <= toDate
        })
      return { events: events.slice(0, limit) }
    }

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
