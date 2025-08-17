import home from '../routes/home.js'
import assets from '../routes/assets.js'
import health from '../routes/health.js'

const plugin = {
  name: 'router',
  register: (server, options) => {
    server.route([].concat(
      home,
      assets,
      health
    ))
  },
}

export default plugin
