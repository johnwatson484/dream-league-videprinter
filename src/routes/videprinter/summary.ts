import type { ServerRoute } from '@hapi/hapi'
import { eventsStore } from '../../videprinter/state/events-store.ts'
import config from '../../config.ts'
import { fetchEventsByDateRange } from '../../videprinter/storage/mongo.ts'
import { fetchMatchesByDateRange } from '../../videprinter/storage/match-store.ts'
import { aggregateCupEvents } from '../../videprinter/aggregation/cup-summary.ts'
import type { GoalEvent } from '../../videprinter/types.ts'

function aggregateEvents (events: GoalEvent[]): {
  goals: { playerId: number; player: string; team: string; goals: number; confidence: number }[]
  conceded: { teamId: number; team: string; conceded: number; confidence: number }[]
  unmatched: { scorer: string; team: string; minute: number | null; competition: string }[]
} {
  const goalCounts = new Map<number, { playerId: number; player: string; team: string; goals: number; totalConfidence: number }>()
  const concedeCounts = new Map<number, { teamId: number; team: string; conceded: number; totalConfidence: number }>()
  const unmatched: { scorer: string; team: string; minute: number | null; competition: string }[] = []

  for (const event of events) {
    if (event.potentialGoalFor?.playerId) {
      const existing = goalCounts.get(event.potentialGoalFor.playerId)
      if (existing) {
        existing.goals++
        existing.totalConfidence += event.potentialGoalFor.confidence
      } else {
        goalCounts.set(event.potentialGoalFor.playerId, {
          playerId: event.potentialGoalFor.playerId,
          player: event.potentialGoalFor.player,
          team: event.potentialGoalFor.team,
          goals: 1,
          totalConfidence: event.potentialGoalFor.confidence
        })
      }
    } else {
      unmatched.push({
        scorer: event.scorer.name,
        team: event.scoringTeam.name,
        minute: event.minute,
        competition: event.competition
      })
    }

    if (event.potentialConcedingFor?.teamId) {
      const existing = concedeCounts.get(event.potentialConcedingFor.teamId)
      if (existing) {
        existing.conceded++
        existing.totalConfidence += event.potentialConcedingFor.confidence
      } else {
        concedeCounts.set(event.potentialConcedingFor.teamId, {
          teamId: event.potentialConcedingFor.teamId,
          team: event.potentialConcedingFor.team,
          conceded: 1,
          totalConfidence: event.potentialConcedingFor.confidence
        })
      }
    }
  }

  const goals = [...goalCounts.values()].map(g => ({
    playerId: g.playerId,
    player: g.player,
    team: g.team,
    goals: g.goals,
    confidence: g.totalConfidence / g.goals
  }))

  const conceded = [...concedeCounts.values()].map(c => ({
    teamId: c.teamId,
    team: c.team,
    conceded: c.conceded,
    confidence: c.totalConfidence / c.conceded
  }))

  return { goals, conceded, unmatched }
}

const route: ServerRoute = {
  method: 'GET',
  path: '/videprinter/summary',
  options: {
    description: 'Return aggregated goal/concede data for a date range',
    auth: false,
    tags: ['videprinter'],
  },
  handler: async (request, h) => {
    const { from, to } = request.query as { from?: string; to?: string }
    if (!from || !to) {
      return h.response({ error: 'from and to query parameters are required (ISO date format)' }).code(400)
    }

    const fromDate = new Date(from)
    const toDate = new Date(to)

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return h.response({ error: 'Invalid date format. Use ISO 8601.' }).code(400)
    }

    let events: GoalEvent[]
    const mongoCfg = config.get('mongo')

    if (mongoCfg.enabled) {
      events = await fetchEventsByDateRange(fromDate, toDate)
    } else {
      const allEvents = eventsStore.list({ limit: 500, order: 'desc' })
      events = allEvents.filter(e => {
        const ts = new Date(e.utcTimestamp)
        return ts >= fromDate && ts <= toDate
      })
    }

    const leagueResult = aggregateEvents(events)

    const matches = mongoCfg.enabled ? await fetchMatchesByDateRange(fromDate, toDate) : []
    const cupResult = aggregateCupEvents(events, matches)

    return { ...leagueResult, ...cupResult }
  },
}

export default route
