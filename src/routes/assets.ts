import type { ServerRoute } from '@hapi/hapi'

const route: ServerRoute = {
  method: 'GET',
  path: '/assets/{path*}',
  handler: {
    directory: {
      path: 'src/assets',
      redirectToSlash: true,
      index: false,
    },
  },
}

export default route
