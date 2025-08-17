import home from '../routes/home.js'
import assets from '../routes/assets.js'
import health from '../routes/health.js'
import videprinter from '../routes/videprinter/index.js'

const plugin = {
  name: 'router',
  register: (server, options) => {
    server.route([].concat(
      home,
      assets,
      health,
      videprinter
    ))
  },
}

export default plugin
