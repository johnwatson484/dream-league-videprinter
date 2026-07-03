import Inert from '@hapi/inert'
import Crumb from '@hapi/crumb'
import logging from './logging.js'
import Scooter from '@hapi/scooter'
import csp from './content-security-policy.js'
import headers from './headers.js'
import errors from './errors.js'
import views from './views.js'
import router from './router.js'

async function registerPlugins (server) {
  const plugins = [
    Inert,
    Crumb,
    Scooter,
    csp,
    logging,
    errors,
    headers,
    views,
    router
  ]

  await server.register(plugins)
}

export { registerPlugins }
