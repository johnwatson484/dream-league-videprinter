import crypto from 'node:crypto'
import type { GoalEvent } from '../types.ts'
import config from '../../config.ts'

const TEAM_NAMES = [
  'Barnsley', 'Bolton', 'Derby', 'Portsmouth', 'Oxford', 'Blackpool',
  'Peterborough', 'Charlton', 'Wigan', 'Reading', 'Exeter', 'Lincoln'
]
const SCORERS = ['Smith', 'Jones', 'Brown', 'Taylor', 'Johnson', 'Evans']

let fixtureCounter = 1

function pick<T> (arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]! }

export async function fetchLiveGoals (): Promise<GoalEvent[]> {
  const ds = config.get('dataSource')
  const comps = ds.liveScore.competitions as Record<string, number>
  const compEntries = Object.entries(comps)
  if (!compEntries.length) { return [] }
  if (Math.random() >= 0.2) { return [] }

  const compEntry = pick(compEntries)
  const competitionNameMap: Record<string, string> = {
    premierLeague: 'Premier League',
    championship: 'Championship',
    leagueOne: 'League One',
    leagueTwo: 'League Two',
    nationalLeague: 'National League',
    faCup: 'FA Cup',
    leagueCup: 'League Cup'
  }

  const home = pick(TEAM_NAMES)
  let away = pick(TEAM_NAMES)
  while (away === home) { away = pick(TEAM_NAMES) }
  const scoringTeamIsHome = Math.random() < 0.5
  const scorer = pick(SCORERS)
  const minute = Math.floor(Math.random() * 90) + 1
  const homeGoals = scoringTeamIsHome ? 1 : 0
  const awayGoals = scoringTeamIsHome ? 0 : 1

  return [{
    id: `mock-${fixtureCounter++}-${minute}-${crypto.randomUUID()}`,
    fixtureId: String(`mock-${fixtureCounter}`),
    competition: competitionNameMap[compEntry[0]] || compEntry[0],
    utcTimestamp: new Date(),
    minute,
    scoringTeam: { name: scoringTeamIsHome ? home : away },
    concedingTeam: { name: scoringTeamIsHome ? away : home },
    scorer: { name: scorer, normalizedName: scorer.toLowerCase() },
    assist: null,
    scoreAfterEvent: { home: homeGoals, away: awayGoals },
    phase: 'LIVE',
    source: 'mock',
  }]
}
