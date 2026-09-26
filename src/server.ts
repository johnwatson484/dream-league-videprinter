import Hapi from '@hapi/hapi'
import type { Server } from '@hapi/hapi'
import Joi from 'joi'
import { registerPlugins } from './plugins/index.ts'
import config from './config.ts'
import logger from './logger.ts'
import { initMongo, closeMongo } from './videprinter/storage/mongo.ts'
import { persistRequestCount } from './videprinter/state/request-counter.ts'

async function createServer (): Promise<Server> {
  const server = Hapi.server({
    host: config.get('host'),
    port: config.get('port'),
    routes: {
      validate: {
        options: {
          abortEarly: false,
        },
      },
    },
    router: {
      stripTrailingSlash: true,
    },
  })

  server.validator(Joi)
  await registerPlugins(server)

  server.ext('onPreStart', async () => { await initMongo(logger) })
  server.ext('onPostStop', async () => {
    await persistRequestCount()
    await closeMongo()
  })

  return server
}

export { createServer }
