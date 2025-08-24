import Blankie from 'blankie'

const plugin = {
  plugin: Blankie,
  options: {
    fontSrc: ['self', 'fonts.gstatic.com', 'cdn.jsdelivr.net'],
    imgSrc: ['self'],
    scriptSrc: ['self', 'unsafe-inline', 'cdn.jsdelivr.net'],
    styleSrc: ['self', 'unsafe-inline', 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
    connectSrc: ['self'],
    frameAncestors: ['self'],
    formAction: ['self'],
    generateNonces: false
  }
}

export default plugin
