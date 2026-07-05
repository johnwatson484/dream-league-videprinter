import type { ServerRoute } from '@hapi/hapi'

const route: ServerRoute = {
  method: 'GET',
  path: '/',
  handler: (request, h) => {
    return h.redirect('/live-scores')
  },
}

export default route
