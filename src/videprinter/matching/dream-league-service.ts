import type { GoalEvent } from '../types.ts'
import { fetchDreamLeagueTeams } from '../fetchers/dream-league.ts'
import { fuzzyMatcher } from './fuzzy-matcher.ts'
import logger from '../../logger.ts'

class DreamLeagueService {
  lastUpdateTime = 0
  updateInterval = 5 * 60 * 1000
  isUpdating = false

  async initialize (): Promise<void> {
    try {
      await this.updateDreamLeagueData()
      logger.info('[dream-league-service] initialized')
    } catch (error) {
      logger.error('[dream-league-service] initialization failed: %s', (error as Error).message)
    }
  }

  async updateDreamLeagueData (): Promise<void> {
    const now = Date.now()

    if (this.isUpdating) { return }

    if (now - this.lastUpdateTime < this.updateInterval) { return }

    this.isUpdating = true

    try {
      const dreamLeagueData = await fetchDreamLeagueTeams()
      fuzzyMatcher.updateData(dreamLeagueData.players, dreamLeagueData.goalkeepers)
      this.lastUpdateTime = now

      const summary = fuzzyMatcher.getSummary()
      logger.info(`[dream-league-service] updated data: ${summary.playersLoaded} players, ${summary.goalkeepersLoaded} goalkeeper teams, ${summary.uniqueManagers} managers`)
    } catch (error) {
      logger.error('[dream-league-service] update failed: %s', (error as Error).message)
    } finally {
      this.isUpdating = false
    }
  }

  async enhanceGoal (goal: GoalEvent): Promise<GoalEvent> {
    await this.updateDreamLeagueData()

    const enhanced: GoalEvent = { ...goal }

    try {
      const playerMatches = fuzzyMatcher.findPlayerMatches(
        goal.scorer?.name,
        goal.scoringTeam?.name
      )

      if (playerMatches.length > 0) {
        const bestPlayerMatch = playerMatches[0]!
        enhanced.potentialGoalFor = {
          manager: bestPlayerMatch.player.manager,
          player: bestPlayerMatch.player.name,
          playerId: bestPlayerMatch.player.playerId,
          team: bestPlayerMatch.player.team,
          confidence: bestPlayerMatch.confidence,
          substitute: bestPlayerMatch.player.substitute || false
        }
      }

      const goalkeeperMatches = fuzzyMatcher.findGoalkeeperMatches(
        goal.concedingTeam?.name
      )

      if (goalkeeperMatches.length > 0) {
        const bestGoalkeeperMatch = goalkeeperMatches[0]!
        enhanced.potentialConcedingFor = {
          manager: bestGoalkeeperMatch.team.manager,
          team: bestGoalkeeperMatch.team.name,
          teamId: bestGoalkeeperMatch.team.teamId,
          confidence: bestGoalkeeperMatch.confidence,
          substitute: bestGoalkeeperMatch.team.substitute || false
        }
      }
    } catch (error) {
      logger.error('[dream-league-service] goal enhancement failed: %s', (error as Error).message)
    }

    return enhanced
  }

  getStatus (): { lastUpdate: string; isUpdating: boolean; nextUpdateDue: string; playersLoaded: number; goalkeepersLoaded: number; uniqueManagers: number } {
    const summary = fuzzyMatcher.getSummary()
    return {
      lastUpdate: new Date(this.lastUpdateTime).toISOString(),
      isUpdating: this.isUpdating,
      nextUpdateDue: new Date(this.lastUpdateTime + this.updateInterval).toISOString(),
      ...summary
    }
  }
}

export const dreamLeagueService = new DreamLeagueService()
