import type { Server } from '@hapi/hapi'
import Inert from '@hapi/inert'
import Crumb from '@hapi/crumb'
import logging from './logging.ts'
import Scooter from '@hapi/scooter'
import csp from './content-security-policy.ts'
import headers from './headers.ts'
import errors from './errors.ts'
import views from './views.ts'
import router from './router.ts'
import pulse from './pulse.ts'

async function registerPlugins (server: Server): Promise<void> {
  const plugins: any[] = [
    Inert,
    Crumb,
    Scooter,
    csp,
    logging,
    errors,
    headers,
    views,
    router,
    pulse
  ]

  await server.register(plugins)
}

export { registerPlugins }
