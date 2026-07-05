import type { DreamLeagueTeamData } from '../types.ts'
import config from '../../config.ts'

let cachedTeamData: DreamLeagueTeamData | null = null
let lastFetchTime = 0
const CACHE_DURATION = 5 * 60 * 1000

export async function fetchDreamLeagueTeams (fetcher: typeof fetch = fetch): Promise<DreamLeagueTeamData> {
  const now = Date.now()

  if (cachedTeamData && (now - lastFetchTime) < CACHE_DURATION) {
    return cachedTeamData
  }

  const dreamLeagueCfg = config.get('dataSource.dreamLeague')

  if (!dreamLeagueCfg.enabled) {
    return { players: [], goalkeepers: [] }
  }

  try {
    const url = `${dreamLeagueCfg.apiUrl}/manager/teams`
    const response = await fetcher(url)

    if (!response.ok) {
      console.error(`[dream-league] API error: ${response.status} ${response.statusText}`)
      return cachedTeamData || { players: [], goalkeepers: [] }
    }

    const data = await response.json()
    cachedTeamData = {
      players: data?.data?.players || [],
      goalkeepers: data?.data?.goalkeepers || []
    }
    lastFetchTime = now

    console.log(`[dream-league] fetched ${cachedTeamData.players.length} players and ${cachedTeamData.goalkeepers.length} goalkeeper teams`)

    return cachedTeamData
  } catch (error) {
    console.error('[dream-league] fetch error:', (error as Error).message)
    return cachedTeamData || { players: [], goalkeepers: [] }
  }
}

export function clearCache (): void {
  cachedTeamData = null
  lastFetchTime = 0
}
