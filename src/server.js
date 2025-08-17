import Hapi from '@hapi/hapi'
import Joi from 'joi'
import { registerPlugins } from './plugins/index.js'
import config from './config.js'
import { initMongo, closeMongo } from './videprinter/storage/mongo.js'

async function createServer () {
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

  server.ext('onPreStart', async () => { await initMongo(server.logger || console) })
  server.ext('onPostStop', async () => { await closeMongo() })

  return server
}

export { createServer }
