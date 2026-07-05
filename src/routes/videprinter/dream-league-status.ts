import type { ServerRoute } from '@hapi/hapi'
import { dreamLeagueService } from '../../videprinter/matching/dream-league-service.ts'

const route: ServerRoute = {
  method: 'GET',
  path: '/videprinter/dream-league/status',
  options: {
    id: 'videprinter.dreamLeague.status',
    tags: ['videprinter', 'dream-league'],
    cors: true,
    cache: false,
    auth: false,
    description: 'Get Dream League Fantasy Football service status'
  },
  handler: async (request, h) => {
    try {
      const status = dreamLeagueService.getStatus()
      return h.response(status).code(200)
    } catch (error) {
      request.logger?.error('[dream-league] status error:', (error as Error).message)
      return h.response({ error: 'Failed to get Dream League status' }).code(500)
    }
  }
}

export default route
