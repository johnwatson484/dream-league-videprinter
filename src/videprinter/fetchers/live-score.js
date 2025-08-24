import config from '../../config.js'
import { canMakeExternalRequest, noteExternalRequest } from '../state/request-counter.js'
import { batchCheckEventExists } from '../storage/mongo.js'
import crypto from 'crypto'

/*
 LiveScore API docs: https://live-score-api.com/documentation
 We'll call the live scores endpoint (/api-client/matches/live.json) which returns matches with score lines
 and metadata. In most plans, goal-by-goal events are NOT embedded; instead, an events URL is provided per
 match under urls.events that must be queried separately to obtain individual scorers/timestamps.

 Sample match shape (simplified):
 {
   id, status, time, competition: { id, name }, home: { id, name }, away: { id, name },
   scores: { score: "3 - 1", ht_score: "1 - 0", ft_score: "3 - 1" },
   urls: { events: "https://livescore-api.com/api-client/scores/events.json?id=..." }
 }
*/

// Build a Set of allowed competition IDs from dataSource.liveScore.competitions
const COMP_ID_SET = () => {
  try {
    const idMap = config.get('dataSource').liveScore.competitions || {}
    const ids = Object.values(idMap).filter(id => typeof id === 'number' && !Number.isNaN(id))
    return new Set(ids)
  } catch {
    return new Set()
  }
}
let loggedCompCheck = false

function debugCompetitionIds (matches) {
  if (!process.env.DEBUG_COMP_IDS || loggedCompCheck) return
  loggedCompCheck = true
  try {
    const idMap = config.get('dataSource').liveScore.competitions || {}
    const expectedIds = Object.values(idMap).filter(id => typeof id === 'number' && !Number.isNaN(id))
    const expected = { ids: expectedIds, mapping: idMap }
    const seen = new Map()
    for (const m of matches) {
      const cid = m?.competition?.id ?? m.competition_id
      const cname = m?.competition?.name ?? m.competition_name
      seen.set(cid, cname)
    }
    console.log('[comp-id-debug] expected competitions from config:', expected)
    console.log('[comp-id-debug] seen live competitions:', Object.fromEntries(seen))
    const expectedIdsStr = expectedIds.map(String)
    const missing = expectedIdsStr.filter(id => !seen.has(id) && !seen.has(Number(id)))
    if (missing.length) console.log('[comp-id-debug] expected IDs not in current live sample:', missing)
    const unexpected = [...seen.keys()].filter(id => !expectedIdsStr.includes(String(id)))
    if (unexpected.length) console.log('[comp-id-debug] additional live competition IDs (not in config):', unexpected)
  } catch (err) {
    console.warn('[comp-id-debug] failed to log competition id debug', err.message)
  }
}

function extractGoalEvents (match) {
  return match.goals || match.events || []
}

function hasGoalsInMatch (match) {
  // Consider both nested `scores` and legacy top-level score fields
  const s = match?.scores || {}
  const candidates = [
    s.score, s.ft_score, s.ht_score,
    match?.score, match?.ft_score, match?.ht_score
  ]
  for (const str of candidates) {
    const { home, away } = parseScore(str)
    if (home != null && away != null && (home + away) > 0) return true
  }
  return false
}

function parseScore (scoreStr) {
  if (!scoreStr || !/\d+\s*-\s*\d+/.test(scoreStr)) return { home: null, away: null }
  const [hs, as] = scoreStr.split('-').map(s => parseInt(s.trim(), 10))
  return { home: hs, away: as }
}

function getTeamNames (match) {
  return {
    home: match.home_name || match?.home?.name || null,
    away: match.away_name || match?.away?.name || null,
  }
}

function inferScoringTeam (match, homeScore, awayScore, rawGoal) {
  const names = getTeamNames(match)
  // Prefer explicit side from events payload when available
  if (rawGoal?.home_away === 'h') return names.home
  if (rawGoal?.home_away === 'a') return names.away
  if (homeScore == null || awayScore == null) return rawGoal.scorer
  if (homeScore + awayScore === 0) return null
  if (homeScore > awayScore) return names.home
  if (awayScore > homeScore) return names.away
  // scores level -> try scorer text heuristic
  if (rawGoal.scorer?.includes(names.home)) return names.home
  if (rawGoal.scorer?.includes(names.away)) return names.away
  return rawGoal.scorer
}

function normalizeGoal (match, rawGoal) {
  const { home: homeScore, away: awayScore } = parseScore(rawGoal.score)
  const scoringTeamGuess = inferScoringTeam(match, homeScore, awayScore, rawGoal)
  const names = getTeamNames(match)
  const baseStable = rawGoal.eventId
    ? `${match.id}-${rawGoal.eventId}`
    : `${match.id}-${rawGoal.time}-${(rawGoal.scorer || '').toLowerCase()}-${rawGoal.score}`
  const stableHash = crypto.createHash('sha1').update(baseStable).digest('hex').slice(0, 16)
  const eventIdPart = rawGoal.eventId || stableHash

  return {
    id: `${match.id}-${eventIdPart}`,
    fixtureId: String(match.id),
    competition: match?.competition?.name || match.competition_name,
    utcTimestamp: new Date().toISOString(),
    minute: parseInt(rawGoal.time, 10) || null,
    scoringTeam: { name: scoringTeamGuess || 'Unknown' },
    concedingTeam: { name: scoringTeamGuess === names.home ? names.away : names.home },
    scorer: { name: rawGoal.scorer || 'Unknown', normalizedName: (rawGoal.scorer || 'Unknown').toLowerCase() },
    assist: rawGoal.assist ? { name: rawGoal.assist, normalizedName: rawGoal.assist.toLowerCase() } : null,
    scoreAfterEvent: homeScore != null && awayScore != null ? { home: homeScore, away: awayScore } : { home: null, away: null },
    phase: match.status || 'LIVE',
    source: 'live-score',
  }
}

export async function fetchLiveScoreGoals (fetcher = fetch) {
  const shouldLog = process.env.DEBUG_LIVE_SCORE === '1' || process.env.DEBUG_LIVE_SCORE === 'true' || config.get('isDev')
  const { url, ds } = buildLiveUrl()
  if (shouldLog) console.log('[live-score] fetch start provider=%s useMock=%s keyPresent=%s host=%s', ds.provider, ds.useMock, Boolean(ds.liveScore.key), ds.liveScore.host)
  if (!ds.liveScore.key || !ds.liveScore.secret) {
    if (shouldLog) console.log('[live-score] skip: missing API credentials')
    return []
  }
  if (!(await canMakeExternalRequest())) {
    if (shouldLog) console.log('[live-score] skip: daily request cap reached')
    return []
  }
  await noteExternalRequest()
  if (shouldLog) console.log('[live-score] requesting %s', maskSecret(url))
  const matches = await getLiveMatches(fetcher, url, shouldLog)
  if (!matches.length) return []
  const liveCreds = { key: ds.liveScore.key, secret: ds.liveScore.secret }
  return await collectGoals(matches, shouldLog, liveCreds)
}

function buildLiveUrl () {
  const ds = config.get('dataSource')
  const { key, secret, host } = ds.liveScore
  const url = `https://${host}/api-client/matches/live.json?key=${encodeURIComponent(key || '')}&secret=${encodeURIComponent(secret || '')}`
  return { url, ds }
}

function maskSecret (url) { return url.replace(/secret=[^&]*/i, 'secret=***') }

async function getLiveMatches (fetcher, url, shouldLog) {
  const res = await fetcher(url)
  if (shouldLog) console.log('[live-score] response status=%s ok=%s', res.status, res.ok)
  if (!res.ok) return []
  try {
    const json = await res.json()
    const matches = json?.data?.match
    if (!Array.isArray(matches)) {
      if (shouldLog) console.log('[live-score] no matches array in response')
      return []
    }
    if (shouldLog) console.log('[live-score] matches received=%d', matches.length)
    debugCompetitionIds(matches)
    return matches
  } catch (e) {
    if (shouldLog) console.log('[live-score] json parse error: %s', e?.message || e)
    return []
  }
}

async function collectGoals (matches, shouldLog, liveCreds) {
  const compIds = COMP_ID_SET()
  if (shouldLog) console.log('[live-score] competition filter: %s', compIds.size ? Array.from(compIds).join(',') : 'none (include all)')
  const goals = []
  for (const m of matches) {
    const compId = m?.competition?.id ?? m.competition_id
    const compName = m?.competition?.name ?? m.competition_name
    if (!shouldIncludeMatch(m, compIds)) {
      if (shouldLog) console.log('[live-score] skipping match id=%s comp=%s(%s) - not in filter', m.id, compName, compId)
      continue
    }
    if (shouldLog) console.log('[live-score] processing match id=%s comp=%s(%s)', m.id, compName, compId)
    const mGoals = await goalsForMatch(m, shouldLog, liveCreds)
    goals.push(...mGoals)
  }
  if (shouldLog) console.log('[live-score] goals emitted=%d', goals.length)
  return goals
}

function shouldIncludeMatch (match, compIds) {
  const compId = match?.competition?.id ?? match.competition_id
  return !(compIds.size && !compIds.has(Number(compId)))
}

async function goalsForMatch (match, shouldLog, liveCreds) {
  let events = extractGoalEvents(match)
  if (!events.length && hasGoalsInMatch(match) && match?.urls?.events) {
    if (shouldLog) console.log('[live-score] fetching events for match id=%s (score indicates goals present)', match.id)
    try {
      events = await fetchMatchEvents(match, liveCreds, shouldLog)
    } catch (err) {
      if (shouldLog) console.log('[live-score] events fetch failed for match %s: %s', match.id, err?.message || err)
      events = []
    }
  } else if (shouldLog && events.length) {
    console.log('[live-score] using embedded events for match id=%s count=%d', match.id, events.length)
  } else if (shouldLog && !hasGoalsInMatch(match)) {
    console.log('[live-score] skipping events fetch for match id=%s (no goals in score)', match.id)
  }

  const normalizedGoals = events.map(g => normalizeGoal(match, g))

  // Check MongoDB for existing events to prevent duplicates
  const goalIds = normalizedGoals.map(g => g.id)
  const existingIds = await batchCheckEventExists(goalIds)

  // Filter out goals that already exist in MongoDB
  const uniqueGoals = []
  const seenIds = new Set()
  for (const goal of normalizedGoals) {
    // Check if goal already exists in MongoDB
    if (existingIds.has(goal.id)) {
      if (shouldLog) console.log('[live-score] goal already exists in database: id=%s scorer=%s minute=%s', goal.id, goal.scorer.name, goal.minute)
      continue
    }

    // Check local deduplication within this match
    if (!seenIds.has(goal.id)) {
      seenIds.add(goal.id)
      uniqueGoals.push(goal)
      if (shouldLog) console.log('[live-score] new goal added: id=%s scorer=%s minute=%s', goal.id, goal.scorer.name, goal.minute)
    } else if (shouldLog) {
      console.log('[live-score] duplicate goal in match filtered: id=%s scorer=%s minute=%s', goal.id, goal.scorer.name, goal.minute)
    }
  }

  return uniqueGoals
}

function appendCredsToUrl (url, key, secret) {
  if (!url) return url
  const hasKey = /[?&]key=/.test(url)
  const hasSecret = /[?&]secret=/.test(url)
  if (hasKey && hasSecret) return url
  const sep = url.includes('?') ? '&' : '?'
  const params = []
  if (!hasKey) params.push(`key=${encodeURIComponent(key || '')}`)
  if (!hasSecret) params.push(`secret=${encodeURIComponent(secret || '')}`)
  return url + sep + params.join('&')
}

async function fetchMatchEvents (match, liveCreds, shouldLog, fetcher = fetch) {
  try {
    if (!(await canMakeExternalRequest())) {
      if (shouldLog) console.log('[live-score] skip events: daily request cap reached for match id=%s', match.id)
      return []
    }
    await noteExternalRequest()
    const url = appendCredsToUrl(match.urls.events, liveCreds?.key, liveCreds?.secret)
    if (shouldLog) console.log('[live-score] events requesting %s', maskSecret(url))
    const res = await fetcher(url)
    if (shouldLog) console.log('[live-score] events response status=%s ok=%s', res.status, res.ok)
    if (!res.ok) return []
    const json = await res.json()
    const events = json?.data?.event || json?.data?.events || []
    const ordered = orderEvents(events)
    const mapped = mapGoalEvents(ordered, match)
    if (shouldLog) console.log('[live-score] events parsed for match id=%s count=%d', match.id, mapped.length)
    return mapped
  } catch (err) {
    if (shouldLog) console.log('[live-score] events fetch/parse error for match %s: %s', match?.id, err?.message || err)
    return []
  }
}

function orderEvents (events) {
  return [...events].sort((a, b) => {
    const as = Number(a?.sort)
    const bs = Number(b?.sort)
    if (!Number.isNaN(as) && !Number.isNaN(bs)) return as - bs
    const at = Number(a?.time ?? a?.minute ?? a?.min)
    const bt = Number(b?.time ?? b?.minute ?? b?.min)
    if (!Number.isNaN(at) && !Number.isNaN(bt)) return at - bt
    return 0
  })
}

function determineSide (e) {
  const sideRaw = (e?.home_away || e?.side || e?.team || '').toString().toLowerCase()
  if (sideRaw.startsWith('h')) return 'h'
  if (sideRaw.startsWith('a')) return 'a'
  return null
}

function mapGoalEvents (ordered, match) {
  const out = []
  let runningHomeGoals = 0
  let runningAwayGoals = 0

  for (const e of ordered) {
    if (!isLikelyGoalEvent(e)) continue

    let finalScore = null
    const side = determineSide(e) || inferSideFromTeamName(e, match)

    // If event has explicit score, use it directly
    if (e?.score && /\d+\s*-\s*\d+/.test(String(e.score))) {
      const eventScore = parseScore(String(e.score))
      finalScore = `${eventScore.home} - ${eventScore.away}`
      runningHomeGoals = eventScore.home
      runningAwayGoals = eventScore.away
    } else {
      // No explicit score on event - increment based on which side scored
      if (side === 'h') {
        runningHomeGoals += 1
      } else if (side === 'a') {
        runningAwayGoals += 1
      } else {
        // Can't determine side, skip this event to avoid incorrect counting
        continue
      }
      finalScore = `${runningHomeGoals} - ${runningAwayGoals}`
    }

    out.push({
      time: String(e.time ?? e.minute ?? e.min ?? ''),
      scorer: getGoalScorer(e),
      assist: getAssist(e),
      score: finalScore,
      home_away: side,
      eventId: String(e.id ?? e.event_id ?? e.eventId ?? '')
    })
  }
  return out
}

function inferSideFromTeamName (e, match) {
  if (!match) return null
  const teamStr = (e?.team || e?.team_name || e?.club || '').toString().toLowerCase()
  const homeName = (match.home_name || match?.home?.name || '').toString().toLowerCase()
  const awayName = (match.away_name || match?.away?.name || '').toString().toLowerCase()
  if (teamStr && homeName && teamStr.includes(homeName)) return 'h'
  if (teamStr && awayName && teamStr.includes(awayName)) return 'a'
  return null
}

function isLikelyGoalEvent (e) {
  // Use exact event type matching based on LiveScore API documentation
  const eventType = (e?.event || '').toString().toUpperCase()
  return ['GOAL', 'GOAL_PENALTY', 'OWN_GOAL'].includes(eventType)
}

function getGoalScorer (e) {
  const baseScorer = e?.scorer || e?.player || e?.player_name || e?.name || 'Unknown'
  const eventType = (e?.event || '').toString().toUpperCase()

  // Add "OG" suffix for own goals
  if (eventType === 'OWN_GOAL') {
    return `${baseScorer} OG`
  }

  return baseScorer
}

function getAssist (e) {
  return e?.assist || e?.assist_name || e?.info || null
}

// removed unused goalScoreString helper after events refactor
