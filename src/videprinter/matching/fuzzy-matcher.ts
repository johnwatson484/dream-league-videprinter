import Fuse from 'fuse.js'
import type { DreamLeaguePlayer, DreamLeagueGoalkeeper, NormalizedPlayer, NormalizedTeam, PlayerMatch, GoalkeeperMatch } from '../types.ts'
import { normalizeTeamName as normalizeTeamNameShared, isTeamMatch as isTeamMatchShared, hasConflictingDiscriminator } from './team-name.ts'

export class FuzzyMatcher {
  playerFuse: Fuse<NormalizedPlayer> | null = null
  teamFuse: Fuse<NormalizedTeam> | null = null
  players: DreamLeaguePlayer[] = []
  goalkeepers: DreamLeagueGoalkeeper[] = []
  uniqueTeams: NormalizedTeam[] = []

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
      keys: ['name', 'alias', 'normalizedName', 'normalizedAlias']
    }

    this.uniqueTeams = goalkeepers.reduce<NormalizedTeam[]>((acc, gk) => {
      if (!acc.some(t => t.name === gk.name)) {
        acc.push({
          name: gk.name,
          ...(gk.alias ? { alias: gk.alias } : {}),
          normalizedName: this.normalizeTeamName(gk.name),
          normalizedAlias: this.normalizeTeamName(gk.alias || ''),
          teamId: gk.teamId,
          managerId: gk.managerId,
          manager: gk.manager,
          substitute: gk.substitute
        })
      }
      return acc
    }, [])

    this.teamFuse = new Fuse(this.uniqueTeams, teamOptions)
  }

  // Player-name normalization: strips generic club suffixes since it also gates player<->team
  // comparisons where the discriminating word doesn't matter (e.g. matching a player to "Wigan").
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

  // Team-name normalization: delegates to the shared, discriminator-preserving implementation
  // also used by cup-summary aggregation, so both stay in sync.
  normalizeTeamName (name: string): string {
    return normalizeTeamNameShared(name)
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
    if (!concedingTeam) { return [] }

    // Exact match against the canonical name or alias first - the provider is expected to send
    // full official team names, so this alone resolves same-prefix clubs like Sheffield
    // United/Wednesday or Bristol City/Rovers without ever reaching the fuzzy fallback.
    const query = this.normalizeTeamName(concedingTeam)
    const exact = this.uniqueTeams.find(t => !t.substitute && (t.normalizedName === query || (t.normalizedAlias && t.normalizedAlias === query)))
    if (exact) {
      return [{ team: exact, confidence: 1, matchType: 'goalkeeper' }]
    }

    if (!this.teamFuse) { return [] }
    const teamMatches = this.teamFuse.search(concedingTeam)

    return teamMatches
      .filter(match => {
        if (match.item.substitute) { return false }
        if (hasConflictingDiscriminator(query, match.item.normalizedName)) { return false }

        return (1 - (match.score ?? 0)) > 0.7
      })
      .map(match => ({
        team: match.item,
        confidence: 1 - (match.score ?? 0),
        matchType: 'goalkeeper' as const
      }))
  }

  isTeamMatch (team1: string, team2: string): boolean {
    return isTeamMatchShared(team1, team2)
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
