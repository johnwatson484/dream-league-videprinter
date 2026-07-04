import HapiPino from 'hapi-pino'

const plugin = {
  plugin: HapiPino,
  options: {
    level: 'warn',
  },
}

export default plugin
