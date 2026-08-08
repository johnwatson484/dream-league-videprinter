import type { Plugin, Server, ServerOptions } from '@hapi/hapi'
import HapiAuthApiKey from 'hapi-auth-api-key'
import config from '../config.ts'

const plugin: Plugin<ServerOptions> = {
  name: 'auth',
  register: async (server: Server) => {
    await server.register({ plugin: HapiAuthApiKey, options: { apiKey: config.get('apiKey') } })
    server.auth.strategy('api-key', 'api-key')
  },
}

export default plugin
