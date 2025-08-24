import config from '../../config.js'

let cachedTeamData = null
let lastFetchTime = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

/**
 * Fetch all players and goalkeepers from Dream League Fantasy Football API
 * Results are cached for 5 minutes to avoid excessive API calls
 */
export async function fetchDreamLeagueTeams (fetcher = fetch) {
  const now = Date.now()

  // Return cached data if still fresh
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
    console.error('[dream-league] fetch error:', error.message)
    return cachedTeamData || { players: [], goalkeepers: [] }
  }
}

/**
 * Clear the cache (useful for testing)
 */
export function clearCache () {
  cachedTeamData = null
  lastFetchTime = 0
}
