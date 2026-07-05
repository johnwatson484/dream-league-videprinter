import type { ServerRoute } from '@hapi/hapi'

const route: ServerRoute = {
  method: 'GET',
  path: '/live-scores',
  handler: (request, h) => {
    return h.view('live-scores')
  },
}

export default route
