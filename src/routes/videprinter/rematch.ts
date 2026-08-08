import type { ServerRoute } from '@hapi/hapi'
import { rematchAllEvents } from '../../videprinter/matching/rematch.ts'

const route: ServerRoute = {
  method: 'POST',
  path: '/videprinter/rematch',
  options: {
    description: 'Re-fetch current teamsheets and rematch every stored goal event against them',
    auth: 'api-key',
    cors: true,
    tags: ['videprinter'],
    plugins: { crumb: false },
  },
  handler: async (request, h) => {
    const summary = await rematchAllEvents()
    return summary
  },
}

export default route
