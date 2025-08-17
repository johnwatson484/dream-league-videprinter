import Blankie from 'blankie'

const plugin = {
  plugin: Blankie,
  options: {
    fontSrc: ['self'],
    imgSrc: ['self'],
    scriptSrc: ['self', 'unsafe-inline', 'cdn.jsdelivr.net'],
    styleSrc: ['self', 'unsafe-inline', 'cdn.jsdelivr.net'],
    frameAncestors: ['self'],
    formAction: ['self'],
    generateNonces: false
  }
}

export default plugin
