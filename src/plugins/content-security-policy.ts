import type { ServerRegisterPluginObject } from '@hapi/hapi'
import Blankie from 'blankie'

const plugin: ServerRegisterPluginObject<any> = {
  plugin: Blankie,
  options: {
    fontSrc: ['self', 'fonts.gstatic.com', 'cdn.jsdelivr.net'],
    imgSrc: ['self', 'data:'],
    scriptSrc: ['self', 'unsafe-inline', 'cdn.jsdelivr.net'],
    styleSrc: ['self', 'unsafe-inline', 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
    connectSrc: ['self', 'cdn.jsdelivr.net'],
    frameAncestors: ['self'],
    formAction: ['self'],
    generateNonces: false
  }
}

export default plugin
