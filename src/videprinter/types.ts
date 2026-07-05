export interface GoalEvent {
  id: string
  fixtureId: string
  competition: string
  utcTimestamp: Date
  minute: number | null
  scoringTeam: { name: string }
  concedingTeam: { name: string }
  scorer: { name: string; normalizedName: string }
  assist: { name: string; normalizedName: string } | null
  scoreAfterEvent: { home: number | null; away: number | null }
  phase: string
  source: string
  potentialGoalFor?: {
    manager: string
    player: string
    playerId: number
    team: string
    confidence: number
    substitute: boolean
  }
  potentialConcedingFor?: {
    manager: string
    team: string
    teamId: number
    confidence: number
    substitute: boolean
  }
}

export interface DreamLeaguePlayer {
  playerId: number
  name: string
  position: string
  team: string
  manager: string
  substitute: boolean
}

export interface DreamLeagueGoalkeeper {
  teamId: number
  name: string
  manager: string
  substitute: boolean
}

export interface NormalizedPlayer extends DreamLeaguePlayer {
  normalizedName: string
}

export interface NormalizedTeam extends DreamLeagueGoalkeeper {
  normalizedName: string
}

export interface PlayerMatch {
  player: NormalizedPlayer
  confidence: number
  matchType: 'player'
}

export interface GoalkeeperMatch {
  team: NormalizedTeam
  confidence: number
  matchType: 'goalkeeper'
}

export interface DreamLeagueTeamData {
  players: DreamLeaguePlayer[]
  goalkeepers: DreamLeagueGoalkeeper[]
}

export interface ListOptions {
  limit?: number | undefined
  order?: 'asc' | 'desc' | undefined
}
