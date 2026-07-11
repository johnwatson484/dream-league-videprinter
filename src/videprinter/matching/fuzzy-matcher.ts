import Fuse from 'fuse.js'
import type { DreamLeaguePlayer, DreamLeagueGoalkeeper, NormalizedPlayer, NormalizedTeam, PlayerMatch, GoalkeeperMatch } from '../types.ts'

export class FuzzyMatcher {
  playerFuse: Fuse<NormalizedPlayer> | null = null
  teamFuse: Fuse<NormalizedTeam> | null = null
  players: DreamLeaguePlayer[] = []
  goalkeepers: DreamLeagueGoalkeeper[] = []

  updateData (players: DreamLeaguePlayer[], goalkeepers: DreamLeagueGoalkeeper[]): void {
    this.players = players
    this.goalkeepers = goalkeepers

    const playerOptions = {
      includeScore: true,
      threshold: 0.6,
      keys: ['name', 'normalizedName']
    }

    const playersWithNormalized: NormalizedPlayer[] = players.map(player => ({
      ...player,
      normalizedName: this.normalizeName(player.name)
    }))

    this.playerFuse = new Fuse(playersWithNormalized, playerOptions)

    const teamOptions = {
      includeScore: true,
      threshold: 0.3,
      keys: ['name', 'normalizedName']
    }

    const uniqueTeams: NormalizedTeam[] = goalkeepers.reduce<NormalizedTeam[]>((acc, gk) => {
      if (!acc.some(t => t.name === gk.name)) {
        acc.push({
          name: gk.name,
          normalizedName: this.normalizeName(gk.name),
          teamId: gk.teamId,
          manager: gk.manager,
          substitute: gk.substitute
        })
      }
      return acc
    }, [])

    this.teamFuse = new Fuse(uniqueTeams, teamOptions)
  }

  normalizeName (name: string): string {
    if (!name) { return '' }

    return name
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\b(fc|united|city|town|rovers|wanderers|athletic|county|albion)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  findPlayerMatches (scorerName: string, scoringTeam?: string): PlayerMatch[] {
    if (!this.playerFuse || !scorerName) { return [] }

    const nameMatches = this.playerFuse.search(scorerName)

    const results: PlayerMatch[] = nameMatches
      .filter(match => {
        if (match.item.substitute) { return false }

        if (!scoringTeam) { return true }
        return this.isTeamMatch(match.item.team, scoringTeam)
      })
      .map(match => ({
        player: match.item,
        confidence: 1 - (match.score ?? 0),
        matchType: 'player' as const
      }))

    return results.filter(r => {
      if (r.confidence <= 0.5) { return false }

      const scorerNormalized = this.normalizeName(scorerName)
      const playerNormalized = this.normalizeName(r.player.name)

      const scorerWords = scorerNormalized.split(' ').filter(w => w.length > 1)
      const playerWords = new Set(playerNormalized.split(' ').filter(w => w.length > 1))
      const commonWords = scorerWords.filter(w => playerWords.has(w))

      return commonWords.length > 0 || r.confidence > 0.8
    })
  }

  findGoalkeeperMatches (concedingTeam: string): GoalkeeperMatch[] {
    if (!this.teamFuse || !concedingTeam) { return [] }

    const teamMatches = this.teamFuse.search(concedingTeam)

    return teamMatches
      .filter(match => {
        if (match.item.substitute) { return false }

        return (1 - (match.score ?? 0)) > 0.7
      })
      .map(match => ({
        team: match.item,
        confidence: 1 - (match.score ?? 0),
        matchType: 'goalkeeper' as const
      }))
  }

  isTeamMatch (team1: string, team2: string): boolean {
    if (!team1 || !team2) { return false }

    const normalized1 = this.normalizeName(team1)
    const normalized2 = this.normalizeName(team2)

    if (normalized1.length < 4 || normalized2.length < 4) {
      return normalized1 === normalized2
    }

    return normalized1.includes(normalized2) || normalized2.includes(normalized1)
  }

  getSummary (): { playersLoaded: number; goalkeepersLoaded: number; uniqueManagers: number } {
    return {
      playersLoaded: this.players.length,
      goalkeepersLoaded: this.goalkeepers.length,
      uniqueManagers: new Set([
        ...this.players.map(p => p.manager),
        ...this.goalkeepers.map(g => g.manager)
      ]).size
    }
  }
}

export const fuzzyMatcher = new FuzzyMatcher()
