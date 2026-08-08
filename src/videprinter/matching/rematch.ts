import type { GoalEvent, RematchSummary } from '../types.ts'
import config from '../../config.ts'
import logger from '../../logger.ts'
import { dreamLeagueService } from './dream-league-service.ts'
import { eventsStore } from '../state/events-store.ts'
import { fetchAllEvents, saveEvents } from '../storage/mongo.ts'

function hasChanged (before: GoalEvent, after: GoalEvent): boolean {
  const beforeGoal = before.potentialGoalFor
  const afterGoal = after.potentialGoalFor
  const beforeConceding = before.potentialConcedingFor
  const afterConceding = after.potentialConcedingFor

  return beforeGoal?.playerId !== afterGoal?.playerId ||
    beforeConceding?.teamId !== afterConceding?.teamId
}

export async function rematchAllEvents (): Promise<RematchSummary> {
  await dreamLeagueService.forceRefresh()

  const events = config.get('mongo').enabled ? await fetchAllEvents() : eventsStore.all()

  let eventsChanged = 0
  let unmatched = 0
  const rematched: GoalEvent[] = []

  for (const event of events) {
    // Strip stale matches first so a goal that no longer matches anyone isn't left with its old match.
    const { potentialGoalFor: _potentialGoalFor, potentialConcedingFor: _potentialConcedingFor, ...raw } = event
    const enhanced = await dreamLeagueService.enhanceGoal(raw as GoalEvent)

    if (hasChanged(event, enhanced)) { eventsChanged++ }
    if (!enhanced.potentialGoalFor) { unmatched++ }

    rematched.push(enhanced)
    eventsStore.update(enhanced)
  }

  if (config.get('mongo').enabled) {
    await saveEvents(rematched)
  }

  const summary: RematchSummary = {
    eventsProcessed: rematched.length,
    eventsChanged,
    unmatched,
    teamsheet: dreamLeagueService.getStatus(),
  }

  logger.info('[rematch] processed=%d changed=%d unmatched=%d', summary.eventsProcessed, summary.eventsChanged, summary.unmatched)

  return summary
}
