import config from '../../config.js'
import { canMakeExternalRequest, noteExternalRequest } from '../state/request-counter.js'
import crypto from 'crypto'

/*
 LiveScore API docs: https://live-score-api.com/documentation
 We'll call the live scores endpoint (e.g. /matches/live.json) which returns matches with score & goals.
 Free tier limits calls & may not include all desired comps simultaneously; we filter competitions.

 Expected JSON shape (simplified / pseudo):
 {
   data: {
     match: [
       { id, competition_id, competition_name, home_name, away_name, home_id, away_id, score, status, events: [ { time, scorer, score } ] }
     ]
   }
 }
 Some plans require extra endpoint for goals; adjust if needed.
*/

const COMP_ID_SET = () => config.get('dataSource').liveScore.competitionIdSet || new Set()
let loggedCompCheck = false

function debugCompetitionIds (matches) {
  if (!process.env.DEBUG_COMP_IDS || loggedCompCheck) return
  loggedCompCheck = true
  try {
    const expected = config.get('dataSource').liveScore.competitions
    const seen = new Map()
    for (const m of matches) seen.set(m.competition_id, m.competition_name)
    console.log('[comp-id-debug] expected mapping:', expected)
    console.log('[comp-id-debug] seen live mapping:', Object.fromEntries(seen))
    const expectedIds = Object.values(expected).map(String)
    const missing = expectedIds.filter(id => !seen.has(id) && !seen.has(Number(id)))
    if (missing.length) console.log('[comp-id-debug] expected IDs not in current live sample:', missing)
    const unexpected = [...seen.keys()].filter(id => !expectedIds.includes(String(id)))
    if (unexpected.length) console.log('[comp-id-debug] additional live competition IDs (review):', unexpected)
  } catch (err) {
    console.warn('[comp-id-debug] failed to log competition id debug', err.message)
  }
}

function extractGoalEvents (match) {
  return match.goals || match.events || []
}

function parseScore (scoreStr) {
  if (!scoreStr || !/\d+\s*-\s*\d+/.test(scoreStr)) return { home: null, away: null }
  const [hs, as] = scoreStr.split('-').map(s => parseInt(s.trim(), 10))
  return { home: hs, away: as }
}

function inferScoringTeam (match, homeScore, awayScore, rawGoal) {
  if (homeScore == null || awayScore == null) return rawGoal.scorer
  if (homeScore + awayScore === 0) return null
  if (homeScore > awayScore) return match.home_name
  if (awayScore > homeScore) return match.away_name
  // scores level -> try scorer text heuristic
  if (rawGoal.scorer?.includes(match.home_name)) return match.home_name
  if (rawGoal.scorer?.includes(match.away_name)) return match.away_name
  return rawGoal.scorer
}

function normalizeGoal (match, rawGoal) {
  const { home: homeScore, away: awayScore } = parseScore(rawGoal.score)
  const scoringTeamGuess = inferScoringTeam(match, homeScore, awayScore, rawGoal)

  return {
    id: `${match.id}-${rawGoal.time}-${crypto.randomUUID()}`,
    fixtureId: String(match.id),
    competition: match.competition_name,
    utcTimestamp: new Date().toISOString(),
    minute: parseInt(rawGoal.time, 10) || null,
    scoringTeam: { name: scoringTeamGuess || 'Unknown' },
    concedingTeam: { name: scoringTeamGuess === match?.home_name ? match.away_name : match.home_name },
    scorer: { name: rawGoal.scorer || 'Unknown', normalizedName: (rawGoal.scorer || 'Unknown').toLowerCase() },
    assist: null,
    scoreAfterEvent: homeScore != null && awayScore != null ? { home: homeScore, away: awayScore } : { home: null, away: null },
    phase: match.status || 'LIVE',
    source: 'live-score',
  }
}

export async function fetchLiveScoreGoals (fetcher = fetch) {
  const ds = config.get('dataSource')
  const { key, secret, host } = ds.liveScore
  if (!key || !secret) return []
  const compIds = COMP_ID_SET()
  // Live matches endpoint
  const url = `https://${host}/scores/live.json?key=${encodeURIComponent(key)}&secret=${encodeURIComponent(secret)}`
  if (!(await canMakeExternalRequest())) return []
  await noteExternalRequest()
  const res = await fetcher(url)
  if (!res.ok) return []
  let matches
  try {
    const json = await res.json()
    matches = json?.data?.match
    if (!Array.isArray(matches)) return []
  } catch { return [] }
  debugCompetitionIds(matches)
  const goals = []
  for (const m of matches) {
    if (compIds.size && !compIds.has(Number(m.competition_id))) continue
    const events = extractGoalEvents(m)
    for (const g of events) {
      // Expect g = { time: '12', scorer: 'Player Name', score: '1 - 0' }
      goals.push(normalizeGoal(m, g))
    }
  }
  return goals
}
