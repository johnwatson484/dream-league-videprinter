// Mock fetcher returns synthetic goal events in the SAME format as the live-score fetcher normalization
import crypto from 'crypto'
import config from '../../config.js'

const TEAM_NAMES = [
  'Barnsley', 'Bolton', 'Derby', 'Portsmouth', 'Oxford', 'Blackpool',
  'Peterborough', 'Charlton', 'Wigan', 'Reading', 'Exeter', 'Lincoln'
]
const SCORERS = ['Smith', 'Jones', 'Brown', 'Taylor', 'Johnson', 'Evans']

let fixtureCounter = 1

function pick (arr) { return arr[Math.floor(Math.random() * arr.length)] }

export async function fetchLiveGoals () {
  const ds = config.get('dataSource')
  const comps = ds.liveScore.competitions
  const compEntries = Object.entries(comps)
  if (!compEntries.length) return []
  if (Math.random() >= 0.2) return [] // 20% chance to emit a goal batch of size 1

  const compEntry = pick(compEntries) // [key, id]
  const competitionNameMap = {
    championship: 'Championship',
    leagueOne: 'League One',
    leagueTwo: 'League Two',
    faCup: 'FA Cup',
    leagueCup: 'League Cup',
    scottishPremiership: 'Scottish Premiership',
    premierLeague: 'Premier League'
  }

  const home = pick(TEAM_NAMES)
  let away = pick(TEAM_NAMES)
  while (away === home) away = pick(TEAM_NAMES)
  const scoringTeamIsHome = Math.random() < 0.5
  const scorer = pick(SCORERS)
  const minute = Math.floor(Math.random() * 90) + 1
  const homeGoals = scoringTeamIsHome ? 1 : 0
  const awayGoals = scoringTeamIsHome ? 0 : 1
  const scoreStr = `${homeGoals} - ${awayGoals}`
  const goalEventRaw = {
    time: String(minute),
    scorer,
    score: scoreStr,
  }
  const match = {
    id: `mock-${fixtureCounter++}`,
    competition_id: compEntry[1],
    competition_name: competitionNameMap[compEntry[0]] || compEntry[0],
    home_name: home,
    away_name: away,
    status: 'LIVE',
    goals: [goalEventRaw],
  }

  // Reuse normalize logic shape used by live-score provider
  return [{
    id: `${match.id}-${goalEventRaw.time}-${crypto.randomUUID()}`,
    fixtureId: String(match.id),
    competition: match.competition_name,
    utcTimestamp: new Date().toISOString(),
    minute,
    scoringTeam: { name: scoringTeamIsHome ? home : away },
    concedingTeam: { name: scoringTeamIsHome ? away : home },
    scorer: { name: scorer, normalizedName: scorer.toLowerCase() },
    assist: null,
    scoreAfterEvent: { home: homeGoals, away: awayGoals },
    phase: match.status,
    source: 'mock',
  }]
}
