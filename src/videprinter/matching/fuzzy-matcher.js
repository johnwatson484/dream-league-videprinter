import Fuse from 'fuse.js'

/**
 * Fuzzy matching service for players and teams using fuse.js
 */
export class FuzzyMatcher {
  constructor () {
    this.playerFuse = null
    this.teamFuse = null
    this.players = []
    this.goalkeepers = []
  }

  /**
   * Update the fuzzy search indices with new player and goalkeeper data
   */
  updateData (players, goalkeepers) {
    this.players = players
    this.goalkeepers = goalkeepers

    // Configure fuse for player name matching
    const playerOptions = {
      includeScore: true,
      threshold: 0.6, // Higher threshold for more permissive matching (0.6 = 60% similarity required)
      keys: ['name', 'normalizedName']
    }

    // Add normalized names for better matching
    const playersWithNormalized = players.map(player => ({
      ...player,
      normalizedName: this.normalizeName(player.name)
    }))

    this.playerFuse = new Fuse(playersWithNormalized, playerOptions)

    // Configure fuse for team name matching
    const teamOptions = {
      includeScore: true,
      threshold: 0.3, // Stricter for team names
      keys: ['name', 'normalizedName']
    }

    // Create unique team list from goalkeepers
    const uniqueTeams = goalkeepers.reduce((acc, gk) => {
      if (!acc.find(t => t.name === gk.name)) {
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

  /**
   * Normalize a name for better matching (remove common prefixes/suffixes, standardize format)
   */
  normalizeName (name) {
    if (!name) return ''

    return name
      .toLowerCase()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s]/g, ' ') // Replace special characters with spaces
      .replace(/\b(fc|united|city|town|rovers|wanderers|athletic|county|albion)\b/g, '') // Remove common team suffixes
      .replace(/\s+/g, ' ') // Clean up extra spaces
      .trim()
  }

  /**
   * Find potential player matches for a goal scorer
   * Returns array of matches with confidence scores
   */
  findPlayerMatches (scorerName, scoringTeam) {
    if (!this.playerFuse || !scorerName) return []

    // First try exact/fuzzy name matching
    const nameMatches = this.playerFuse.search(scorerName)

    // Filter by team if available and convert to our format
    const results = nameMatches
      .filter(match => {
        // Exclude substitutes from matches
        if (match.item.substitute) return false

        if (!scoringTeam) return true
        // Use fuzzy team matching instead of exact
        return this.isTeamMatch(match.item.team, scoringTeam)
      })
      .map(match => ({
        player: match.item,
        confidence: 1 - match.score, // Convert fuse score to confidence (higher = better)
        matchType: 'player'
      }))

    return results.filter(r => r.confidence > 0.5) // Lowered threshold for better matching
  }

  /**
   * Find potential manager concessions (when their goalkeeper's team concedes)
   * Returns array of matches with manager information
   */
  findGoalkeeperMatches (concedingTeam) {
    if (!this.teamFuse || !concedingTeam) return []

    const teamMatches = this.teamFuse.search(concedingTeam)

    return teamMatches
      .filter(match => {
        // Exclude substitutes from matches
        if (match.item.substitute) return false

        return (1 - match.score) > 0.7 // High confidence for team matches
      })
      .map(match => ({
        team: match.item,
        confidence: 1 - match.score,
        matchType: 'goalkeeper'
      }))
  }

  /**
   * Check if two team names are likely the same team
   */
  isTeamMatch (team1, team2) {
    if (!team1 || !team2) return false

    const normalized1 = this.normalizeName(team1)
    const normalized2 = this.normalizeName(team2)

    // If normalized names are very short, use exact match
    if (normalized1.length < 4 || normalized2.length < 4) {
      return normalized1 === normalized2
    }

    // Check if one is contained in the other (for cases like "Arsenal" vs "Arsenal FC")
    return normalized1.includes(normalized2) || normalized2.includes(normalized1)
  }

  /**
   * Get summary of currently loaded data
   */
  getSummary () {
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

// Export singleton instance
export const fuzzyMatcher = new FuzzyMatcher()
