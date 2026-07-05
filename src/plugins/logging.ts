import type { ServerRegisterPluginObject } from '@hapi/hapi'
import HapiPino from 'hapi-pino'

const plugin: ServerRegisterPluginObject<any> = {
  plugin: HapiPino,
  options: {
    level: 'warn',
  },
}

export default plugin
