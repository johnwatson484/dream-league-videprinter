import type { GoalEvent } from '../types.ts'
import config from '../../config.ts'
import { canMakeExternalRequest, noteExternalRequest } from '../state/request-counter.ts'
import { batchCheckEventExists } from '../storage/mongo.ts'
import crypto from 'node:crypto'

interface RawGoal {
  time?: string
  minute?: string
  min?: string
  scorer?: string
  assist?: string
  assist_name?: string
  info?: string
  score?: string
  home_away?: string
  eventId?: string
}

interface LiveMatch {
  id: string | number
  status?: string
  competition?: { id?: string | number; name?: string }
  competition_id?: string | number
  competition_name?: string
  home?: { id?: string; name?: string }
  away?: { id?: string; name?: string }
  home_name?: string
  away_name?: string
  scores?: { score?: string; ht_score?: string; ft_score?: string }
  score?: string
  ft_score?: string
  ht_score?: string
  goals?: RawGoal[]
  events?: RawGoal[]
  urls?: { events?: string }
}

interface RawEvent {
  id?: string | number
  event_id?: string | number
  eventId?: string | number
  event?: string
  time?: string | number
  minute?: string | number
  min?: string | number
  sort?: string | number
  scorer?: string
  player?: string
  player_name?: string
  name?: string
  assist?: string
  assist_name?: string
  info?: string
  score?: string
  home_away?: string
  side?: string
  team?: string
  team_name?: string
  club?: string
}

interface MappedGoal {
  time: string
  scorer: string
  assist: string | null
  score: string
  home_away: string | null
  eventId: string
}

type NormalizeInput = RawGoal | MappedGoal

interface LiveCreds {
  key: string
  secret: string
}

const COMP_ID_SET = (): Set<number> => {
  try {
    const idMap = config.get('dataSource').liveScore.competitions as Record<string, unknown> || {}
    const ids = Object.values(idMap).filter((id): id is number => typeof id === 'number' && !Number.isNaN(id))
    return new Set(ids)
  } catch {
    return new Set()
  }
}
let loggedCompCheck = false

function debugCompetitionIds (matches: LiveMatch[]): void {
  if (!process.env.DEBUG_COMP_IDS || loggedCompCheck) { return }
  loggedCompCheck = true
  try {
    const idMap = config.get('dataSource').liveScore.competitions as Record<string, unknown> || {}
    const expectedIds = Object.values(idMap).filter((id): id is number => typeof id === 'number' && !Number.isNaN(id))
    const expected = { ids: expectedIds, mapping: idMap }
    const seen = new Map<string | number, string | undefined>()
    for (const m of matches) {
      const cid = m?.competition?.id ?? m.competition_id
      const cname = m?.competition?.name ?? m.competition_name
      if (cid != null) { seen.set(cid, cname) }
    }
    console.log('[comp-id-debug] expected competitions from config:', expected)
    console.log('[comp-id-debug] seen live competitions:', Object.fromEntries(seen))
    const expectedIdsStr = expectedIds.map(String)
    const missing = expectedIdsStr.filter(id => !seen.has(id) && !seen.has(Number(id)))
    if (missing.length) { console.log('[comp-id-debug] expected IDs not in current live sample:', missing) }
    const unexpected = [...seen.keys()].filter(id => !expectedIdsStr.includes(String(id)))
    if (unexpected.length) { console.log('[comp-id-debug] additional live competition IDs (not in config):', unexpected) }
  } catch (err) {
    console.warn('[comp-id-debug] failed to log competition id debug', (err as Error).message)
  }
}

function extractGoalEvents (match: LiveMatch): RawGoal[] {
  return match.goals || match.events || []
}

function hasGoalsInMatch (match: LiveMatch): boolean {
  const s = match?.scores || {}
  const candidates = [
    s.score, s.ft_score, s.ht_score,
    match?.score, match?.ft_score, match?.ht_score
  ]
  for (const str of candidates) {
    const { home, away } = parseScore(str)
    if (home != null && away != null && (home + away) > 0) { return true }
  }
  return false
}

function parseScore (scoreStr: string | undefined | null): { home: number | null; away: number | null } {
  if (!scoreStr || !/\d+\s*-\s*\d+/.test(scoreStr)) { return { home: null, away: null } }
  const [hs, as] = scoreStr.split('-').map(s => parseInt(s.trim(), 10))
  return { home: hs ?? null, away: as ?? null }
}

function getTeamNames (match: LiveMatch): { home: string | null; away: string | null } {
  return {
    home: match.home_name || match?.home?.name || null,
    away: match.away_name || match?.away?.name || null,
  }
}

function inferScoringTeam (match: LiveMatch, homeScore: number | null, awayScore: number | null, rawGoal: NormalizeInput): string | null {
  const names = getTeamNames(match)
  if (rawGoal?.home_away === 'h') { return names.home }
  if (rawGoal?.home_away === 'a') { return names.away }
  if (homeScore == null || awayScore == null) { return rawGoal.scorer || null }
  if (homeScore + awayScore === 0) { return null }
  if (homeScore > awayScore) { return names.home }
  if (awayScore > homeScore) { return names.away }
  if (rawGoal.scorer?.includes(names.home || '')) { return names.home }
  if (rawGoal.scorer?.includes(names.away || '')) { return names.away }
  return rawGoal.scorer || null
}

function normalizeGoal (match: LiveMatch, rawGoal: NormalizeInput): GoalEvent {
  const { home: homeScore, away: awayScore } = parseScore(rawGoal.score)
  const scoringTeamGuess = inferScoringTeam(match, homeScore, awayScore, rawGoal)
  const names = getTeamNames(match)

  const baseStable = `${match.id}-${rawGoal.time}-${(rawGoal.scorer || '').toLowerCase()}-${rawGoal.score}`
  const stableHash = crypto.createHash('sha1').update(baseStable).digest('hex').slice(0, 16)

  return {
    id: `${match.id}-${stableHash}`,
    fixtureId: String(match.id),
    competition: match?.competition?.name || match.competition_name || '',
    utcTimestamp: new Date(),
    minute: parseInt(rawGoal.time || '', 10) || null,
    scoringTeam: { name: scoringTeamGuess || 'Unknown' },
    concedingTeam: { name: scoringTeamGuess === names.home ? (names.away || 'Unknown') : (names.home || 'Unknown') },
    scorer: { name: rawGoal.scorer || 'Unknown', normalizedName: (rawGoal.scorer || 'Unknown').toLowerCase() },
    assist: rawGoal.assist ? { name: rawGoal.assist, normalizedName: rawGoal.assist.toLowerCase() } : null,
    scoreAfterEvent: homeScore != null && awayScore != null ? { home: homeScore, away: awayScore } : { home: null, away: null },
    phase: match.status || 'LIVE',
    source: 'live-score',
  }
}

export async function fetchLiveScoreGoals (fetcher: typeof fetch = fetch): Promise<GoalEvent[]> {
  const shouldLog = process.env.DEBUG_LIVE_SCORE === '1' || process.env.DEBUG_LIVE_SCORE === 'true' || config.get('isDev')
  const { url, ds } = buildLiveUrl()
  if (shouldLog) { console.log('[live-score] fetch start provider=%s useMock=%s keyPresent=%s host=%s', ds.provider, ds.useMock, Boolean(ds.liveScore.key), ds.liveScore.host) }
  if (!ds.liveScore.key || !ds.liveScore.secret) {
    if (shouldLog) { console.log('[live-score] skip: missing API credentials') }
    return []
  }
  if (!(await canMakeExternalRequest())) {
    if (shouldLog) { console.log('[live-score] skip: daily request cap reached') }
    return []
  }
  await noteExternalRequest()
  if (shouldLog) { console.log('[live-score] requesting %s', maskSecret(url)) }
  const matches = await getLiveMatches(fetcher, url, shouldLog)
  if (!matches.length) { return [] }
  const liveCreds: LiveCreds = { key: ds.liveScore.key, secret: ds.liveScore.secret }
  return await collectGoals(matches, shouldLog, liveCreds)
}

function buildLiveUrl (): { url: string; ds: ReturnType<typeof config.get<'dataSource'>> } {
  const ds = config.get('dataSource')
  const { key, secret, host } = ds.liveScore
  const url = `https://${host}/api-client/matches/live.json?key=${encodeURIComponent(key || '')}&secret=${encodeURIComponent(secret || '')}`
  return { url, ds }
}

function maskSecret (url: string): string { return url.replace(/secret=[^&]*/i, 'secret=***') }

async function getLiveMatches (fetcher: typeof fetch, url: string, shouldLog: boolean): Promise<LiveMatch[]> {
  const res = await fetcher(url)
  if (shouldLog) { console.log('[live-score] response status=%s ok=%s', res.status, res.ok) }
  if (!res.ok) { return [] }
  try {
    const json = await res.json()
    const matches = json?.data?.match
    if (!Array.isArray(matches)) {
      if (shouldLog) { console.log('[live-score] no matches array in response') }
      return []
    }
    if (shouldLog) { console.log('[live-score] matches received=%d', matches.length) }
    debugCompetitionIds(matches)
    return matches as LiveMatch[]
  } catch (e) {
    if (shouldLog) { console.log('[live-score] json parse error: %s', (e as Error)?.message || e) }
    return []
  }
}

async function collectGoals (matches: LiveMatch[], shouldLog: boolean, liveCreds: LiveCreds): Promise<GoalEvent[]> {
  const compIds = COMP_ID_SET()
  if (shouldLog) { console.log('[live-score] competition filter: %s', compIds.size ? Array.from(compIds).join(',') : 'none (include all)') }

  const maxMatchesPerCycle = 80
  const filteredMatches = matches.filter(m => shouldIncludeMatch(m, compIds))
  const matchesToProcess = filteredMatches.slice(0, maxMatchesPerCycle)

  if (filteredMatches.length > maxMatchesPerCycle) {
    if (shouldLog) { console.log('[live-score] WARNING: %d matches found, limiting to %d for API safety', filteredMatches.length, maxMatchesPerCycle) }
  }

  const goals: GoalEvent[] = []
  for (const m of matchesToProcess) {
    const compId = m?.competition?.id ?? m.competition_id
    const compName = m?.competition?.name ?? m.competition_name
    if (shouldLog) { console.log('[live-score] processing match id=%s comp=%s(%s)', m.id, compName, compId) }
    const mGoals = await goalsForMatch(m, shouldLog, liveCreds)
    goals.push(...mGoals)
  }

  goals.sort((a, b) => new Date(b.utcTimestamp).getTime() - new Date(a.utcTimestamp).getTime())

  if (shouldLog) { console.log('[live-score] goals emitted=%d (sorted by latest timestamp)', goals.length) }
  return goals
}

function shouldIncludeMatch (match: LiveMatch, compIds: Set<number>): boolean {
  const compId = match?.competition?.id ?? match.competition_id
  return !(compIds.size && !compIds.has(Number(compId)))
}

async function goalsForMatch (match: LiveMatch, shouldLog: boolean, liveCreds: LiveCreds): Promise<GoalEvent[]> {
  let events: NormalizeInput[] = extractGoalEvents(match)
  if (!events.length && hasGoalsInMatch(match) && match?.urls?.events) {
    if (shouldLog) { console.log('[live-score] fetching events for match id=%s (score indicates goals present)', match.id) }
    try {
      events = await fetchMatchEvents(match, liveCreds, shouldLog)
    } catch (err) {
      if (shouldLog) { console.log('[live-score] events fetch failed for match %s: %s', match.id, (err as Error)?.message || err) }
      events = []
    }
  } else if (shouldLog && events.length) {
    console.log('[live-score] using embedded events for match id=%s count=%d', match.id, events.length)
  } else if (shouldLog && !hasGoalsInMatch(match)) {
    console.log('[live-score] skipping events fetch for match id=%s (no goals in score)', match.id)
  }

  const normalizedGoals = events.map(g => normalizeGoal(match, g))

  const goalIds = normalizedGoals.map(g => g.id)
  const existingIds = await batchCheckEventExists(goalIds)

  const uniqueGoals: GoalEvent[] = []
  const seenIds = new Set<string>()
  for (const goal of normalizedGoals) {
    if (existingIds.has(goal.id)) {
      if (shouldLog) { console.log('[live-score] goal already exists in database: id=%s scorer=%s minute=%s', goal.id, goal.scorer.name, goal.minute) }
      continue
    }

    if (!seenIds.has(goal.id)) {
      seenIds.add(goal.id)
      uniqueGoals.push(goal)
      if (shouldLog) { console.log('[live-score] new goal added: id=%s scorer=%s minute=%s', goal.id, goal.scorer.name, goal.minute) }
    } else if (shouldLog) {
      console.log('[live-score] duplicate goal in match filtered: id=%s scorer=%s minute=%s', goal.id, goal.scorer.name, goal.minute)
    }
  }

  return uniqueGoals
}

function appendCredsToUrl (url: string, key: string, secret: string): string {
  if (!url) { return url }
  const hasKey = /[?&]key=/.test(url)
  const hasSecret = /[?&]secret=/.test(url)
  if (hasKey && hasSecret) { return url }
  const sep = url.includes('?') ? '&' : '?'
  const params: string[] = []
  if (!hasKey) { params.push(`key=${encodeURIComponent(key || '')}`) }
  if (!hasSecret) { params.push(`secret=${encodeURIComponent(secret || '')}`) }
  return url + sep + params.join('&')
}

async function fetchMatchEvents (match: LiveMatch, liveCreds: LiveCreds, shouldLog: boolean, fetcher: typeof fetch = fetch): Promise<MappedGoal[]> {
  try {
    if (!(await canMakeExternalRequest())) {
      if (shouldLog) { console.log('[live-score] skip events: daily request cap reached for match id=%s', match.id) }
      return []
    }
    await noteExternalRequest()
    const url = appendCredsToUrl(match.urls!.events!, liveCreds?.key, liveCreds?.secret)
    if (shouldLog) { console.log('[live-score] events requesting %s', maskSecret(url)) }
    const res = await fetcher(url)
    if (shouldLog) { console.log('[live-score] events response status=%s ok=%s', res.status, res.ok) }
    if (!res.ok) { return [] }
    const json = await res.json()
    const events: RawEvent[] = json?.data?.event || json?.data?.events || []
    const ordered = orderEvents(events)
    const mapped = mapGoalEvents(ordered, match)
    if (shouldLog) { console.log('[live-score] events parsed for match id=%s count=%d', match.id, mapped.length) }
    return mapped
  } catch (err) {
    if (shouldLog) { console.log('[live-score] events fetch/parse error for match %s: %s', match?.id, (err as Error)?.message || err) }
    return []
  }
}

function orderEvents (events: RawEvent[]): RawEvent[] {
  return [...events].sort((a, b) => {
    const as = Number(a?.sort)
    const bs = Number(b?.sort)
    if (!Number.isNaN(as) && !Number.isNaN(bs)) { return as - bs }
    const at = Number(a?.time ?? a?.minute ?? a?.min)
    const bt = Number(b?.time ?? b?.minute ?? b?.min)
    if (!Number.isNaN(at) && !Number.isNaN(bt)) { return at - bt }
    return 0
  })
}

function determineSide (e: RawEvent): string | null {
  const sideRaw = (e?.home_away || e?.side || e?.team || '').toString().toLowerCase()
  if (sideRaw.startsWith('h')) { return 'h' }
  if (sideRaw.startsWith('a')) { return 'a' }
  return null
}

function mapGoalEvents (ordered: RawEvent[], match: LiveMatch): MappedGoal[] {
  const out: MappedGoal[] = []
  let runningHomeGoals = 0
  let runningAwayGoals = 0

  for (const e of ordered) {
    if (!isLikelyGoalEvent(e)) { continue }

    let finalScore: string | null = null
    const side = determineSide(e) || inferSideFromTeamName(e, match)

    if (e?.score && /\d+\s*-\s*\d+/.test(String(e.score))) {
      const eventScore = parseScore(String(e.score))
      finalScore = `${eventScore.home} - ${eventScore.away}`
      runningHomeGoals = eventScore.home ?? 0
      runningAwayGoals = eventScore.away ?? 0
    } else {
      if (side === 'h') {
        runningHomeGoals += 1
      } else if (side === 'a') {
        runningAwayGoals += 1
      } else {
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

function inferSideFromTeamName (e: RawEvent, match: LiveMatch): string | null {
  if (!match) { return null }
  const teamStr = (e?.team || e?.team_name || e?.club || '').toString().toLowerCase()
  const homeName = (match.home_name || match?.home?.name || '').toString().toLowerCase()
  const awayName = (match.away_name || match?.away?.name || '').toString().toLowerCase()
  if (teamStr && homeName && teamStr.includes(homeName)) { return 'h' }
  if (teamStr && awayName && teamStr.includes(awayName)) { return 'a' }
  return null
}

function isLikelyGoalEvent (e: RawEvent): boolean {
  const eventType = (e?.event || '').toString().toUpperCase()
  return ['GOAL', 'GOAL_PENALTY', 'OWN_GOAL'].includes(eventType)
}

function getGoalScorer (e: RawEvent): string {
  const baseScorer = e?.scorer || e?.player || e?.player_name || e?.name || 'Unknown'
  const eventType = (e?.event || '').toString().toUpperCase()

  if (eventType === 'OWN_GOAL') {
    return `${baseScorer} OG`
  }

  return baseScorer
}

function getAssist (e: RawEvent): string | null {
  return e?.assist || e?.assist_name || e?.info || null
}
