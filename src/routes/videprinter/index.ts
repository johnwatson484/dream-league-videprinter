import type { ServerRoute } from '@hapi/hapi'
import liveScoresPage from './live-scores-page.ts'
import stream from './stream.ts'
import history from './history.ts'
import summary from './summary.ts'
import dreamLeagueStatus from './dream-league-status.ts'
import rematch from './rematch.ts'

const routes: ServerRoute[] = [liveScoresPage, stream, history, summary, dreamLeagueStatus, rematch]

export default routes
