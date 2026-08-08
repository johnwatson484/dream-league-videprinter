import type { GoalEvent } from '../types.ts'

// Penalty shootouts don't count towards the league. The data provider has no per-kick
// timing during a shootout, so every kick is reported at a fixed minute of 120 regardless
// of which kick it was or how the match got there - unlike a genuine goal, which is always
// reported at its own distinct minute. Confirmed against real production data: shootout
// kicks still show a normally-increasing score total, so that can't be used to detect them.
export function excludeShootoutGoals (events: GoalEvent[]): GoalEvent[] {
  return events.filter(event => event.minute == null || event.minute < 120)
}
