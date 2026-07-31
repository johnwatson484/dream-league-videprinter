import type { GoalEvent } from '../types.ts'

export interface ManagerScorer {
  playerId: number
  name: string
  goals: number
}

export interface ManagerSummary {
  managerId: number
  manager: string
  goals: number
  conceded: number
  scorers: ManagerScorer[]
}

function getOrCreate (managers: Map<number, ManagerSummary>, managerId: number, manager: string): ManagerSummary {
  const existing = managers.get(managerId)
  if (existing) { return existing }
  const created: ManagerSummary = { managerId, manager, goals: 0, conceded: 0, scorers: [] }
  managers.set(managerId, created)
  return created
}

function addScorer (summary: ManagerSummary, playerId: number, name: string): void {
  const existing = summary.scorers.find(s => s.playerId === playerId)
  if (existing) {
    existing.goals++
    return
  }
  summary.scorers.push({ playerId, name, goals: 1 })
}

export function aggregateEventsByManager (events: GoalEvent[]): ManagerSummary[] {
  const managers = new Map<number, ManagerSummary>()

  for (const event of events) {
    const scoredFor = event.potentialGoalFor
    if (scoredFor?.managerId) {
      const summary = getOrCreate(managers, scoredFor.managerId, scoredFor.manager)
      summary.goals++
      addScorer(summary, scoredFor.playerId, scoredFor.player)
    }

    const concededFor = event.potentialConcedingFor
    if (concededFor?.managerId) {
      const summary = getOrCreate(managers, concededFor.managerId, concededFor.manager)
      summary.conceded++
    }
  }

  for (const summary of managers.values()) {
    summary.scorers.sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
  }

  return [...managers.values()]
}
