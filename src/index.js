import 'log-timestamp'
import { createServer } from './server.js'
import { startPoller } from './videprinter/poller/index.js'

const init = async () => {
  const server = await createServer()
  await server.start()
  console.log('Server running on %s', server.info.uri)
  const cfg = (await import('./config.js')).default
  const ds = cfg.get('dataSource')
  const vp = cfg.get('videprinter')
  console.log(`[videprinter] using provider=${ds.provider} interval=${vp.pollLiveIntervalMs}ms`)
  startPoller(console)
}

await init()
