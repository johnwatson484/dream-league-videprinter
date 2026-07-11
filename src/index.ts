import { createServer } from './server.ts'
import { startPoller } from './videprinter/poller/index.ts'
import { dreamLeagueService } from './videprinter/matching/dream-league-service.ts'
import config from './config.ts'
import logger from './logger.ts'

const init = async () => {
  const server = await createServer()
  await server.start()
  logger.info(`Server started at http://localhost:${server.info.port}`)

  await dreamLeagueService.initialize()

  const ds = config.get('dataSource')
  const vp = config.get('videprinter')
  logger.info(`[videprinter] provider=${ds.provider} useMock=${ds.useMock} pollLiveMs=${vp.pollLiveIntervalMs}`)
  startPoller()
}

await init()
