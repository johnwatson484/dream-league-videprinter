import Fuse from 'fuse.js'
import type { DreamLeaguePlayer, DreamLeagueGoalkeeper, NormalizedPlayer, NormalizedTeam, PlayerMatch, GoalkeeperMatch } from '../types.ts'

// Words that distinguish otherwise identically-prefixed club names (Sheffield United vs
// Sheffield Wednesday, Bristol City vs Bristol Rovers). Never strip these when normalizing a
// team name, and use them to veto a fuzzy match between two names that each contain a
// different one.
const TEAM_DISCRIMINATORS = new Set([
  'united', 'city', 'town', 'rovers', 'wanderers', 'athletic', 'county', 'albion',
  'wednesday', 'forest', 'argyle', 'orient', 'alexandra', 'vale', 'rangers', 'villa',
  'palace', 'hotspur', 'dons', 'stanley'
])

function discriminatorsOf (normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter(word => TEAM_DISCRIMINATORS.has(word)))
}

// Common shorthand for a discriminating word, expanded so e.g. "Man Utd" still lines up with
// "Manchester United" instead of being treated as a distinct, non-conflicting token.
const TEAM_ABBREVIATIONS: Record<string, string> = {
  utd: 'united',
  wed: 'wednesday',
  weds: 'wednesday',
}

// True only when both names carry a discriminator and none of them match - a name with no
// discriminator at all (e.g. "Blackpool") is never treated as conflicting.
function hasConflictingDiscriminator (normalized1: string, normalized2: string): boolean {
  const tokens1 = discriminatorsOf(normalized1)
  const tokens2 = discriminatorsOf(normalized2)
  if (!tokens1.size || !tokens2.size) { return false }
  for (const token of tokens1) { if (tokens2.has(token)) { return false } }
  return true
}

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

  // Team-name normalization: keeps every discriminating word (united/city/rovers/etc) since
  // stripping them is what previously made e.g. "Sheffield United" and "Sheffield Wednesday"
  // collide. Only "fc"/"afc" are dropped, as they never distinguish two league teams.
  normalizeTeamName (name: string): string {
    if (!name) { return '' }

    return name
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\b(a?fc)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map(token => TEAM_ABBREVIATIONS[token] ?? token)
      .join(' ')
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
    if (!team1 || !team2) { return false }

    const normalized1 = this.normalizeTeamName(team1)
    const normalized2 = this.normalizeTeamName(team2)

    if (normalized1 === normalized2) { return true }
    if (hasConflictingDiscriminator(normalized1, normalized2)) { return false }

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
