import 'log-timestamp'
import { createServer } from './server.ts'
import { startPoller } from './videprinter/poller/index.ts'
import { dreamLeagueService } from './videprinter/matching/dream-league-service.ts'
import config from './config.ts'

const init = async () => {
  const server = await createServer()
  await server.start()
  console.log('Server running on %s', server.info.uri)

  // Initialize Dream League service
  await dreamLeagueService.initialize()

  const ds = config.get('dataSource')
  const vp = config.get('videprinter')
  console.log(`[videprinter] provider=${ds.provider} useMock=${ds.useMock} pollLiveMs=${vp.pollLiveIntervalMs}`)
  startPoller(console)
}

await init()
