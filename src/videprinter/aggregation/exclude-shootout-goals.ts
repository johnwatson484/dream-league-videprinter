import type { GoalEvent } from '../types.ts'

// Penalty shootouts don't count towards the league, but the API never says so directly -
// a shootout kick never changes the match's real score, so a goal that doesn't move the
// fixture's running total forward is a shootout kick (or a stale re-poll) and is dropped.
// Callers may pass events in any order (ascending, descending, or interleaved across
// fixtures) - the running total is tracked chronologically per fixture regardless.
export function excludeShootoutGoals (events: GoalEvent[]): GoalEvent[] {
  const chronological = [...events].sort((a, b) => new Date(a.utcTimestamp).getTime() - new Date(b.utcTimestamp).getTime())

  const maxTotalByFixture = new Map<string, number>()
  const rejected = new Set<GoalEvent>()

  for (const event of chronological) {
    const { home, away } = event.scoreAfterEvent
    if (home == null || away == null) { continue }

    const total = home + away
    const maxTotal = maxTotalByFixture.get(event.fixtureId) ?? -1
    if (total <= maxTotal) {
      rejected.add(event)
      continue
    }

    maxTotalByFixture.set(event.fixtureId, total)
  }

  return events.filter(event => !rejected.has(event))
}
