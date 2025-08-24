import { fetchDreamLeagueTeams } from '../fetchers/dream-league.js'
import { fuzzyMatcher } from './fuzzy-matcher.js'

/**
 * Service to enhance goals with Dream League Fantasy Football data
 */
class DreamLeagueService {
  constructor () {
    this.lastUpdateTime = 0
    this.updateInterval = 5 * 60 * 1000 // 5 minutes
    this.isUpdating = false
  }

  /**
   * Initialize the service by loading Dream League data
   */
  async initialize () {
    try {
      await this.updateDreamLeagueData()
      console.log('[dream-league-service] initialized')
    } catch (error) {
      console.error('[dream-league-service] initialization failed:', error.message)
    }
  }

  /**
   * Update Dream League data if needed (respects cache timing)
   */
  async updateDreamLeagueData () {
    const now = Date.now()

    // Avoid concurrent updates
    if (this.isUpdating) return

    // Check if update is needed
    if (now - this.lastUpdateTime < this.updateInterval) return

    this.isUpdating = true

    try {
      const dreamLeagueData = await fetchDreamLeagueTeams()
      fuzzyMatcher.updateData(dreamLeagueData.players, dreamLeagueData.goalkeepers)
      this.lastUpdateTime = now

      const summary = fuzzyMatcher.getSummary()
      console.log(`[dream-league-service] updated data: ${summary.playersLoaded} players, ${summary.goalkeepersLoaded} goalkeeper teams, ${summary.uniqueManagers} managers`)
    } catch (error) {
      console.error('[dream-league-service] update failed:', error.message)
    } finally {
      this.isUpdating = false
    }
  }

  /**
   * Enhance a goal event with Dream League Fantasy Football data
   * Returns the goal with additional potentialGoalFor and potentialConcedingFor fields
   */
  async enhanceGoal (goal) {
    // Ensure we have fresh data
    await this.updateDreamLeagueData()

    const enhanced = { ...goal }

    try {
      // Check for potential goal scorer matches
      const playerMatches = fuzzyMatcher.findPlayerMatches(
        goal.scorer?.name,
        goal.scoringTeam?.name
      )

      if (playerMatches.length > 0) {
        // Take the best match
        const bestPlayerMatch = playerMatches[0]
        enhanced.potentialGoalFor = {
          manager: bestPlayerMatch.player.manager,
          player: bestPlayerMatch.player.name,
          team: bestPlayerMatch.player.team,
          confidence: bestPlayerMatch.confidence,
          substitute: bestPlayerMatch.player.substitute || false
        }
      }

      // Check for potential goalkeeper concession matches
      const goalkeeperMatches = fuzzyMatcher.findGoalkeeperMatches(
        goal.concedingTeam?.name
      )

      if (goalkeeperMatches.length > 0) {
        // Take the best match
        const bestGoalkeeperMatch = goalkeeperMatches[0]
        enhanced.potentialConcedingFor = {
          manager: bestGoalkeeperMatch.team.manager,
          team: bestGoalkeeperMatch.team.name,
          confidence: bestGoalkeeperMatch.confidence,
          substitute: bestGoalkeeperMatch.team.substitute || false
        }
      }
    } catch (error) {
      console.error('[dream-league-service] goal enhancement failed:', error.message)
    }

    return enhanced
  }

  /**
   * Get current status/summary of the service
   */
  getStatus () {
    const summary = fuzzyMatcher.getSummary()
    return {
      lastUpdate: new Date(this.lastUpdateTime).toISOString(),
      isUpdating: this.isUpdating,
      nextUpdateDue: new Date(this.lastUpdateTime + this.updateInterval).toISOString(),
      ...summary
    }
  }
}

// Export singleton instance
export const dreamLeagueService = new DreamLeagueService()
