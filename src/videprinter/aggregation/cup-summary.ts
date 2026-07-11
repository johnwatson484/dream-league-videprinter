import type { GoalEvent, MatchRecord } from '../types.ts'

function normalizeTeamName (name: string): string {
  if (!name) { return '' }
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(fc|united|city|town|rovers|wanderers|athletic|county|albion)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function teamsMatch (a: string, b: string): boolean {
  const na = normalizeTeamName(a)
  const nb = normalizeTeamName(b)
  if (na.length < 4 || nb.length < 4) { return na === nb }
  return na.includes(nb) || nb.includes(na)
}

function buildTeamFirstMatchMap (matches: MatchRecord[], events: GoalEvent[]): Map<string, string> {
  const fixtureTimestamps = new Map<string, { teams: Set<string>; timestamp: Date }>()

  for (const match of matches) {
    const entry = fixtureTimestamps.get(match.fixtureId) || { teams: new Set(), timestamp: match.utcTimestamp }
    entry.teams.add(normalizeTeamName(match.homeTeam))
    entry.teams.add(normalizeTeamName(match.awayTeam))
    fixtureTimestamps.set(match.fixtureId, entry)
  }

  for (const event of events) {
    if (!fixtureTimestamps.has(event.fixtureId)) {
      fixtureTimestamps.set(event.fixtureId, { teams: new Set(), timestamp: event.utcTimestamp })
    }
    const entry = fixtureTimestamps.get(event.fixtureId)!
    if (event.scoringTeam?.name) { entry.teams.add(normalizeTeamName(event.scoringTeam.name)) }
    if (event.concedingTeam?.name) { entry.teams.add(normalizeTeamName(event.concedingTeam.name)) }
    if (new Date(event.utcTimestamp) < new Date(entry.timestamp)) {
      entry.timestamp = event.utcTimestamp
    }
  }

  const sorted = [...fixtureTimestamps.entries()].sort((a, b) =>
    new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime()
  )

  const teamFirstFixture = new Map<string, string>()
  for (const [fixtureId, { teams }] of sorted) {
    for (const team of teams) {
      if (team && !teamFirstFixture.has(team)) {
        teamFirstFixture.set(team, fixtureId)
      }
    }
  }
  return teamFirstFixture
}

function findFirstFixtureForTeam (teamName: string, teamFirstFixture: Map<string, string>): string | null {
  const norm = normalizeTeamName(teamName)
  if (teamFirstFixture.has(norm)) { return teamFirstFixture.get(norm)! }
  for (const [key, fixtureId] of teamFirstFixture) {
    if (teamsMatch(norm, key)) { return fixtureId }
  }
  return null
}

export function aggregateCupEvents (events: GoalEvent[], matches: MatchRecord[]): {
  goalsCup: { playerId: number; player: string; team: string; goals: number; confidence: number }[]
  concededCup: { teamId: number; team: string; conceded: number; confidence: number }[]
} {
  const teamFirstFixture = buildTeamFirstMatchMap(matches, events)

  const goalCounts = new Map<number, { playerId: number; player: string; team: string; goals: number; totalConfidence: number }>()
  const concedeCounts = new Map<number, { teamId: number; team: string; conceded: number; totalConfidence: number }>()

  for (const event of events) {
    if (event.potentialGoalFor?.playerId) {
      const playerTeam = event.potentialGoalFor.team
      const firstFixture = findFirstFixtureForTeam(playerTeam, teamFirstFixture)
      if (firstFixture && event.fixtureId === firstFixture) {
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
            totalConfidence: event.potentialGoalFor.confidence,
          })
        }
      }
    }

    if (event.potentialConcedingFor?.teamId) {
      const keeperTeam = event.potentialConcedingFor.team
      const firstFixture = findFirstFixtureForTeam(keeperTeam, teamFirstFixture)
      if (firstFixture && event.fixtureId === firstFixture) {
        const existing = concedeCounts.get(event.potentialConcedingFor.teamId)
        if (existing) {
          existing.conceded++
          existing.totalConfidence += event.potentialConcedingFor.confidence
        } else {
          concedeCounts.set(event.potentialConcedingFor.teamId, {
            teamId: event.potentialConcedingFor.teamId,
            team: event.potentialConcedingFor.team,
            conceded: 1,
            totalConfidence: event.potentialConcedingFor.confidence,
          })
        }
      }
    }
  }

  const goalsCup = [...goalCounts.values()].map(g => ({
    playerId: g.playerId,
    player: g.player,
    team: g.team,
    goals: g.goals,
    confidence: g.totalConfidence / g.goals,
  }))

  const concededCup = [...concedeCounts.values()].map(c => ({
    teamId: c.teamId,
    team: c.team,
    conceded: c.conceded,
    confidence: c.totalConfidence / c.conceded,
  }))

  return { goalsCup, concededCup }
}
