import home from '../routes/home.ts'
import assets from '../routes/assets.ts'
import health from '../routes/health.ts'
import videprinter from '../routes/videprinter/index.ts'

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
