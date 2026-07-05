import type { ServerRoute } from '@hapi/hapi'

const routes: ServerRoute[] = [{
  method: 'GET',
  path: '/healthy',
  handler: (request, h) => {
    return h.response('ok')
  },
}, {
  method: 'GET',
  path: '/healthz',
  handler: (request, h) => {
    return h.response('ok')
  },
}]

export default routes
