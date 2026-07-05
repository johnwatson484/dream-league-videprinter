import type { ServerRegisterPluginObject } from '@hapi/hapi'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nunjucks from 'nunjucks'
import Vision from '@hapi/vision'
import config from '../config.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const plugin: ServerRegisterPluginObject<any> = {
  plugin: Vision,
  options: {
    engines: {
      njk: {
        compile: (src: string, options: any) => {
          const template = nunjucks.compile(src, options.environment)

          return (context: any) => {
            return template.render(context)
          }
        },
        prepare: (options: any, next: () => void) => {
          options.compileOptions.environment = nunjucks.configure(path.join(options.relativeTo || process.cwd(), options.path), {
            autoescape: true,
            watch: false,
          })

          return next()
        },
      },
    },
    path: '../views',
    relativeTo: __dirname,
    isCached: !config.get('isDev'),
    context: {
      assetPath: '/assets',
      appName: config.get('appName'),
    },
  },
}

export default plugin
