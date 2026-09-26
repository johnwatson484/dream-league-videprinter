import type { GoalEvent, MatchRecord } from '../types.ts'
import config from '../../config.ts'
import parentLogger from '../../logger.ts'
import { canMakeExternalRequest, noteExternalRequest } from '../state/request-counter.ts'
import { fetchActiveEventsForFixture } from '../storage/mongo.ts'
import { eventsStore } from '../state/events-store.ts'
import { fixturePollMemo } from '../state/fixture-poll-memo.ts'
import { PendingFixtureTracker } from '../state/pending-fixtures.ts'
import { excludeShootoutGoals } from '../aggregation/exclude-shootout-goals.ts'
import { contentSignatureFor } from '../aggregation/event-signature.ts'
import { fetchWithTimeout } from './fetch-with-timeout.ts'

const logger = parentLogger.child({ component: 'live-score' })

export interface GoalRetraction {
  id: string
  fixtureId: string
}

export interface LiveScorePollResult {
  goals: GoalEvent[]
  matches: MatchRecord[]
  retractions: GoalRetraction[]
}

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
  scheduled?: string
  added?: string
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

// `matches/events.json` returns `player`/`info` as `{ id, name }` objects and signals the
// side with `is_home`/`is_away` booleans, whereas older payloads used plain strings and
// `home_away`/`side`/`team`. Both shapes are accepted so either source normalizes cleanly.
type NamedRef = string | { id?: string | number | null; name?: string | null } | null

interface RawEvent {
  id?: string | number
  event_id?: string | number
  eventId?: string | number
  event?: string
  time?: string | number
  minute?: string | number
  min?: string | number
  sort?: string | number
  scorer?: NamedRef
  player?: NamedRef
  player_name?: string
  name?: string
  assist?: NamedRef
  assist_name?: string
  info?: NamedRef
  score?: string
  home_away?: string
  side?: string
  team?: string
  team_name?: string
  club?: string
  is_home?: boolean
  is_away?: boolean
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

interface MatchEventsResult {
  events: MappedGoal[]
  failed: boolean
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
  if (loggedCompCheck) { return }
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
    logger.debug({ expected, seen: Object.fromEntries(seen) }, 'competition id check')
    const expectedIdsStr = expectedIds.map(String)
    const missing = expectedIdsStr.filter(id => !seen.has(id) && !seen.has(Number(id)))
    if (missing.length) { logger.debug({ missing }, 'expected IDs not in current live sample') }
    const unexpected = [...seen.keys()].filter(id => !expectedIdsStr.includes(String(id)))
    if (unexpected.length) { logger.debug({ unexpected }, 'additional live competition IDs (not in config)') }
  } catch (err) {
    logger.warn({ err }, 'failed to log competition id debug')
  }
}

function extractGoalEvents (match: LiveMatch): RawGoal[] {
  return match.goals || match.events || []
}

function hasGoalsInMatch (match: LiveMatch): boolean {
  const total = totalGoalsFromScore(match)
  return total != null && total > 0
}

// The first field with a nonzero total wins, matching the old hasGoalsInMatch precedence -
// used to sanity-check that a poll's goal events aren't missing/incomplete before trusting
// it enough to retract anything.
function totalGoalsFromScore (match: LiveMatch): number | null {
  const s = match?.scores || {}
  const candidates = [
    s.score, s.ft_score, s.ht_score,
    match?.score, match?.ft_score, match?.ht_score
  ]
  let fallback: number | null = null
  for (const str of candidates) {
    const { home, away } = parseScore(str)
    if (home == null || away == null) { continue }
    const total = home + away
    if (total > 0) { return total }
    fallback ??= total
  }
  return fallback
}

function parseScore (scoreStr: string | undefined | null): { home: number | null; away: number | null } {
  if (!scoreStr || !/\d+\s*-\s*\d+/.test(scoreStr)) { return { home: null, away: null } }
  const [hs, as] = scoreStr.split('-').map(s => Number.parseInt(s.trim(), 10))
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

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// `scheduled` is the kick-off time of day in UTC and `added` is when the match joined the
// live feed, roughly 15 minutes before kick-off, so `added` supplies the missing date.
function resolveKickoff (match: LiveMatch): Date | null {
  const scheduled = /^(\d{1,2}):(\d{2})$/.exec((match.scheduled || '').trim())
  const added = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec((match.added || '').trim())
  if (!scheduled || !added) { return null }

  const addedMs = Date.UTC(Number(added[1]), Number(added[2]) - 1, Number(added[3]), Number(added[4]), Number(added[5]))
  let kickoffMs = Date.UTC(Number(added[1]), Number(added[2]) - 1, Number(added[3]), Number(scheduled[1]), Number(scheduled[2]))
  // A match added late in the evening for a kick-off just after midnight rolls into the next day.
  if (kickoffMs < addedMs - 12 * HOUR_MS) { kickoffMs += DAY_MS }

  return Number.isNaN(kickoffMs) ? null : new Date(kickoffMs)
}

// Approximate: ignores stoppage and the half-time break, but it orders goals across
// matches with different kick-offs, which the ingest time cannot do.
function goalTimestamp (match: LiveMatch, minute: number | null): Date {
  const kickoff = resolveKickoff(match)
  if (!kickoff || minute == null) { return new Date() }
  return new Date(kickoff.getTime() + minute * 60 * 1000)
}

function normalizeGoal (match: LiveMatch, rawGoal: NormalizeInput): Omit<GoalEvent, 'id'> {
  const { home: homeScore, away: awayScore } = parseScore(rawGoal.score)
  const scoringTeamGuess = inferScoringTeam(match, homeScore, awayScore, rawGoal)
  const names = getTeamNames(match)
  const minute = Number.parseInt(rawGoal.time || '', 10) || null

  return {
    fixtureId: String(match.id),
    competition: match?.competition?.name || match.competition_name || '',
    utcTimestamp: goalTimestamp(match, minute),
    minute,
    scoringTeam: { name: scoringTeamGuess || 'Unknown' },
    concedingTeam: { name: scoringTeamGuess === names.home ? (names.away || 'Unknown') : (names.home || 'Unknown') },
    scorer: { name: rawGoal.scorer || 'Unknown', normalizedName: (rawGoal.scorer || 'Unknown').toLowerCase() },
    assist: rawGoal.assist ? { name: rawGoal.assist, normalizedName: rawGoal.assist.toLowerCase() } : null,
    scoreAfterEvent: homeScore != null && awayScore != null ? { home: homeScore, away: awayScore } : { home: null, away: null },
    phase: match.status || 'LIVE',
    source: 'live-score',
  }
}

// Oldest first, with a stable tie-break on original position - used to assign ordinals
// deterministically regardless of the order the provider happens to list goals in.
function orderByTime (events: NormalizeInput[]): NormalizeInput[] {
  return events
    .map((event, index) => ({ event, index, minute: Number.parseInt(event.time || '', 10) }))
    .sort((a, b) => {
      const aMinute = Number.isNaN(a.minute) ? Number.POSITIVE_INFINITY : a.minute
      const bMinute = Number.isNaN(b.minute) ? Number.POSITIVE_INFINITY : b.minute
      return aMinute !== bMinute ? aMinute - bMinute : a.index - b.index
    })
    .map(wrapped => wrapped.event)
}

// 'h'/'a' when the scoring team resolves to a known side, else a distinct bucket per guessed
// name so genuinely ambiguous goals still get their own ordinal rather than colliding.
function sideFor (scoringTeamName: string, names: { home: string | null; away: string | null }): string {
  if (scoringTeamName === names.home) { return 'h' }
  if (scoringTeamName === names.away) { return 'a' }
  return `unknown:${scoringTeamName}`
}

// Identity is `match + side + Nth goal for that side`, not scorer/minute/score text, so a
// provider correction (renamed scorer, confirmed stoppage time) updates the same goal instead
// of minting a new one. Raw entries that are byte-for-byte repeats within this snapshot are
// collapsed here too, before they can consume an ordinal slot as a phantom extra goal.
function buildGoalEvents (match: LiveMatch, rawGoals: NormalizeInput[]): GoalEvent[] {
  const names = getTeamNames(match)
  const ordinals = new Map<string, number>()
  const seenSignatures = new Set<string>()
  const result: GoalEvent[] = []

  for (const rawGoal of orderByTime(rawGoals)) {
    const partial = normalizeGoal(match, rawGoal)
    const side = sideFor(partial.scoringTeam.name, names)
    const signature = `${side}|${contentSignatureFor(partial)}`
    if (seenSignatures.has(signature)) { continue }
    seenSignatures.add(signature)

    const ordinal = (ordinals.get(side) ?? 0) + 1
    ordinals.set(side, ordinal)
    result.push({ ...partial, id: `${match.id}-${side}-${ordinal}` })
  }

  return result
}

export async function fetchLiveScoreGoals (fetcher: typeof fetch = fetch): Promise<GoalEvent[]> {
  const result = await fetchLiveScoreData(fetcher)
  return result.goals
}

export async function fetchLiveScoreData (fetcher: typeof fetch = fetch): Promise<LiveScorePollResult> {
  const { url, ds } = buildLiveUrl()
  logger.debug('fetch start provider=%s useMock=%s keyPresent=%s host=%s', ds.provider, ds.useMock, Boolean(ds.liveScore.key), ds.liveScore.host)
  if (!ds.liveScore.key || !ds.liveScore.secret) {
    logger.warn('skip: missing API credentials')
    return { goals: [], matches: [], retractions: [] }
  }
  if (!(await canMakeExternalRequest())) {
    logger.warn('skip: daily request cap of %d reached, no further polling until it resets', ds.dailyRequestCap)
    return { goals: [], matches: [], retractions: [] }
  }
  logger.debug('requesting %s', maskSecret(url))
  const matches = await getLiveMatches(fetcher, url)
  if (!matches.length) { return { goals: [], matches: [], retractions: [] } }
  const liveCreds: LiveCreds = { key: ds.liveScore.key, secret: ds.liveScore.secret }
  return await collectGoalsAndMatches(matches, liveCreds, fetcher)
}

function buildLiveUrl (): { url: string; ds: ReturnType<typeof config.get<'dataSource'>> } {
  const ds = config.get('dataSource')
  const { key, secret, host } = ds.liveScore
  const url = `https://${host}/api-client/matches/live.json?key=${encodeURIComponent(key || '')}&secret=${encodeURIComponent(secret || '')}`
  return { url, ds }
}

function maskSecret (url: string): string { return url.replace(/secret=[^&]*/i, 'secret=***') }

async function getLiveMatches (fetcher: typeof fetch, url: string): Promise<LiveMatch[]> {
  const res = await issueRequest(fetcher, url, 'live matches')
  if (!res) { return [] }
  try {
    const json = await res.json()
    const matches = json?.data?.match
    if (!Array.isArray(matches)) {
      logger.warn('live matches response contained no match array')
      return []
    }
    logger.debug('matches received=%d', matches.length)
    debugCompetitionIds(matches)
    return matches as LiveMatch[]
  } catch (e) {
    logger.warn('live matches json parse error: %s', (e as Error)?.message || e)
    return []
  }
}

// Counted even when it fails: the provider's quota is spent the moment the request leaves,
// and a failure that costs quota without being counted is how an overrun stays invisible.
async function issueRequest (fetcher: typeof fetch, url: string, label: string): Promise<Response | null> {
  const startedAt = Date.now()
  try {
    const res = await fetchWithTimeout(fetcher, url)
    logger.debug('%s response status=%s ok=%s elapsedMs=%d', label, res.status, res.ok, Date.now() - startedAt)
    if (!res.ok) {
      logger.warn('%s request rejected: status=%s elapsedMs=%d', label, res.status, Date.now() - startedAt)
      return null
    }
    return res
  } catch (err) {
    // `message` alone is just "This operation was aborted"; undici puts the real reason
    // (DNS, TLS, connect timeout) on `cause`.
    const error = err as Error & { cause?: unknown; code?: string }
    logger.warn({
      err: error,
      cause: error?.cause,
      code: error?.code,
      name: error?.name,
      elapsedMs: Date.now() - startedAt,
      url: maskSecret(url),
    }, `${label} request failed`)
    return null
  } finally {
    await noteExternalRequest()
  }
}

async function collectGoalsAndMatches (matches: LiveMatch[], liveCreds: LiveCreds, fetcher: typeof fetch): Promise<LiveScorePollResult> {
  const compIds = COMP_ID_SET()
  logger.debug('competition filter: %s', compIds.size ? Array.from(compIds).join(',') : 'none (include all)')

  const maxMatchesPerCycle = 80
  const filteredMatches = matches.filter(m => shouldIncludeMatch(m, compIds))
  const matchesToProcess = filteredMatches.slice(0, maxMatchesPerCycle)

  if (filteredMatches.length > maxMatchesPerCycle) {
    logger.warn('%d matches found, limiting to %d for API safety', filteredMatches.length, maxMatchesPerCycle)
  }

  const matchRecords: MatchRecord[] = matchesToProcess.map(m => {
    const names = getTeamNames(m)
    const scoreStr = m?.scores?.ft_score || m?.scores?.score || m?.ft_score || m?.score || null
    return {
      fixtureId: String(m.id),
      competition: m?.competition?.name || m.competition_name || '',
      homeTeam: names.home || 'Unknown',
      awayTeam: names.away || 'Unknown',
      status: m.status || 'UNKNOWN',
      utcTimestamp: resolveKickoff(m) || new Date(),
      finalScore: scoreStr || null,
    }
  })

  const goals: GoalEvent[] = []
  const retractions: GoalRetraction[] = []
  for (const m of matchesToProcess) {
    const compId = m?.competition?.id ?? m.competition_id
    const compName = m?.competition?.name ?? m.competition_name
    logger.debug('processing match id=%s comp=%s(%s)', m.id, compName, compId)
    const result = await goalsForMatch(m, liveCreds, fetcher)
    goals.push(...result.goals)
    retractions.push(...result.retractions)
  }

  // Oldest first: consumers prepend each goal to the feed, so the newest ends up on top.
  goals.sort((a, b) => new Date(a.utcTimestamp).getTime() - new Date(b.utcTimestamp).getTime())

  logger.debug('goals emitted=%d retractions=%d matches=%d (oldest first)', goals.length, retractions.length, matchRecords.length)
  return { goals, matches: matchRecords, retractions }
}

function shouldIncludeMatch (match: LiveMatch, compIds: Set<number>): boolean {
  const compId = match?.competition?.id ?? match.competition_id
  return !(compIds.size && !compIds.has(Number(compId)))
}

// Fixtures whose score outran their event detail this poll, so a fast independent retry
// loop can recheck just them without waiting for the next full live-matches cycle - and
// can keep rechecking by their remembered urls.events even after they leave the live feed.
const pendingFixtures = new PendingFixtureTracker<LiveMatch>()

export function clearPendingFixtures (): void { pendingFixtures.clear() }

// Existing state for this fixture, keyed by id, sourced from Mongo when enabled (so this
// survives a process restart) or the in-memory events store otherwise.
async function existingEventsForFixture (fixtureId: string): Promise<Map<string, GoalEvent>> {
  const mongoCfg = config.get('mongo')
  const existing = mongoCfg.enabled
    ? await fetchActiveEventsForFixture(fixtureId)
    : eventsStore.all().filter(e => e.fixtureId === fixtureId)
  return new Map(existing.map(e => [e.id, e]))
}

export async function goalsForMatch (match: LiveMatch, liveCreds: LiveCreds, fetcher: typeof fetch = fetch): Promise<{ goals: GoalEvent[]; retractions: GoalRetraction[] }> {
  const fixtureId = String(match.id)
  const existing = await existingEventsForFixture(fixtureId)
  const embedded = extractGoalEvents(match)

  let events: NormalizeInput[] = embedded
  let eventsFetchFailed = false

  if (!embedded.length && hasGoalsInMatch(match) && match?.urls?.events) {
    if (alreadyReconciled(match, fixtureId, existing.size)) {
      logger.debug('skipping events fetch for match id=%s: score, status and stored goals all unchanged', match.id)
      return { goals: [], retractions: [] }
    }
    logger.debug('fetching events for match id=%s (score indicates goals present)', match.id)
    const result = await fetchMatchEvents(match, liveCreds, fetcher)
    events = result.events
    eventsFetchFailed = result.failed
  } else if (embedded.length) {
    logger.debug('using embedded events for match id=%s count=%d', match.id, embedded.length)
  } else if (!hasGoalsInMatch(match)) {
    logger.debug('skipping events fetch for match id=%s (no goals in score)', match.id)
  }

  const candidates = excludeShootoutGoals(buildGoalEvents(match, events))
  const trust = assessPoll(match, candidates, fixtureId, eventsFetchFailed)

  const goals = trust.emit ? changedGoals(candidates, existing) : []
  const retractions = trust.retract ? computeRetractions(candidates, existing, fixtureId) : []

  if (trust.reason === 'events-lagging') {
    pendingFixtures.mark(fixtureId, match)
  } else if (trust.reason !== 'events-fetch-failed') {
    // A transient fetch failure proves nothing either way, so leave any existing mark alone.
    pendingFixtures.forget(fixtureId)
  }

  if (trust.emit && trust.retract) {
    fixturePollMemo.record(fixtureId, totalGoalsFromScore(match) ?? 0, String(match.status || ''))
  } else {
    fixturePollMemo.forget(fixtureId)
  }

  return { goals, retractions }
}

// Rechecks fixtures marked pending by goalsForMatch, using the remembered match snapshot -
// which still carries urls.events - so a fixture keeps getting retried even once it has
// dropped out of the live-matches feed for good. Bounded by pendingFixtureGraceMs so a
// fixture whose events never catch up is eventually given up on, loudly, instead of forever.
export async function retryPendingFixtures (fetcher: typeof fetch = fetch): Promise<LiveScorePollResult> {
  const ds = config.get('dataSource')
  if (!ds.liveScore.key || !ds.liveScore.secret) { return { goals: [], matches: [], retractions: [] } }

  for (const { fixtureId } of pendingFixtures.expire(ds.pendingFixtureGraceMs)) {
    logger.error('giving up on fixture id=%s: events never caught up with the score within %dms, goal(s) may be missing', fixtureId, ds.pendingFixtureGraceMs)
  }

  const liveCreds: LiveCreds = { key: ds.liveScore.key, secret: ds.liveScore.secret }
  const goals: GoalEvent[] = []
  const retractions: GoalRetraction[] = []
  for (const { data: match } of pendingFixtures.all()) {
    const result = await goalsForMatch(match, liveCreds, fetcher)
    goals.push(...result.goals)
    retractions.push(...result.retractions)
  }

  goals.sort((a, b) => new Date(a.utcTimestamp).getTime() - new Date(b.utcTimestamp).getTime())
  return { goals, matches: [], retractions }
}

const FINAL_STATUSES = new Set(['FT', 'AET', 'AP', 'FT_PEN', 'FINISHED', 'AFTER ET', 'AFTER PEN.', 'ABANDONED', 'CANCELLED', 'POSTPONED'])

function isFinalStatus (status: string): boolean {
  return FINAL_STATUSES.has(status.trim().toUpperCase())
}

// Re-fetching every scoring fixture on every cycle is what exhausts the daily request
// budget partway through a busy Saturday. The provider can still revise a goal without the
// score moving, so a live fixture is re-checked on a slower clock rather than never; one
// that has finished and reconciles against its final score is never re-fetched again.
function alreadyReconciled (match: LiveMatch, fixtureId: string, storedGoals: number): boolean {
  const memo = fixturePollMemo.get(fixtureId)
  if (!memo) { return false }

  const expectedGoals = totalGoalsFromScore(match)
  if (expectedGoals == null || storedGoals !== expectedGoals) { return false }

  const status = String(match.status || '')
  if (memo.scoreTotal !== expectedGoals || memo.status !== status) { return false }
  if (isFinalStatus(status)) { return true }

  return Date.now() - memo.at < config.get('dataSource').eventsRefreshMs
}

function changedGoals (candidates: GoalEvent[], existing: Map<string, GoalEvent>): GoalEvent[] {
  const goals: GoalEvent[] = []
  for (const goal of candidates) {
    const priorEvent = existing.get(goal.id)
    if (!priorEvent) {
      logger.debug('new goal: id=%s scorer=%s minute=%s', goal.id, goal.scorer.name, goal.minute)
      goals.push(goal)
      continue
    }
    if (contentSignatureFor(priorEvent) !== contentSignatureFor(goal)) {
      logger.debug('corrected goal: id=%s scorer=%s minute=%s', goal.id, goal.scorer.name, goal.minute)
      goals.push(goal)
    } else {
      logger.debug('goal unchanged since last poll: id=%s scorer=%s minute=%s', goal.id, goal.scorer.name, goal.minute)
    }
  }
  return goals
}

interface PollTrust {
  emit: boolean
  retract: boolean
  reason: 'ok' | 'events-fetch-failed' | 'score-unparseable' | 'events-lagging'
}

// A failed events fetch or a finished match no longer surfacing event detail leaves
// `candidates` empty or short for reasons that have nothing to do with a goal being
// disallowed, so those cases must not be mistaken for a fixture's goals being retracted.
// A short list is not safe to emit either: ids are positional, so the Nth goal slides onto
// an id that already belongs to an earlier goal and overwrites it on save. An unparseable
// score only costs us the ability to verify, so goals still stand - only retraction stops.
function assessPoll (match: LiveMatch, candidates: GoalEvent[], fixtureId: string, eventsFetchFailed: boolean): PollTrust {
  if (eventsFetchFailed) {
    logger.warn('ignoring poll for fixture id=%s: events fetch failed this poll', fixtureId)
    return { emit: false, retract: false, reason: 'events-fetch-failed' }
  }

  const expectedGoals = totalGoalsFromScore(match)
  if (expectedGoals == null) {
    logger.warn('skipping retraction check for fixture id=%s: score unparseable', fixtureId)
    return { emit: true, retract: false, reason: 'score-unparseable' }
  }

  if (candidates.length < expectedGoals) {
    logger.warn('ignoring poll for fixture id=%s: score implies %d goal(s) but only %d event candidate(s) found', fixtureId, expectedGoals, candidates.length)
    return { emit: false, retract: false, reason: 'events-lagging' }
  }

  return { emit: true, retract: true, reason: 'ok' }
}

function computeRetractions (candidates: GoalEvent[], existing: Map<string, GoalEvent>, fixtureId: string): GoalRetraction[] {
  const candidateIds = new Set(candidates.map(g => g.id))
  const retractions: GoalRetraction[] = [...existing.keys()]
    .filter(id => !candidateIds.has(id))
    .map(id => ({ id, fixtureId }))
  if (retractions.length) {
    logger.debug('goals retracted for fixture id=%s ids=%s', fixtureId, retractions.map(r => r.id).join(','))
  }
  return retractions
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

// The provider hands us `match.urls.events` pointing at `scores/events.json?id=<matchId>`,
// but that route hangs until timeout for ANY numeric id (verified with curl: a non-numeric
// id 404s in 0.3s, a real one never responds). `matches/events.json?match_id=<matchId>` on
// the same host returns the same payload in ~0.25s, so build the URL ourselves and treat
// `urls.events` purely as the provider's signal that events exist for this fixture.
function eventsUrlFor (match: LiveMatch): string {
  const { host } = config.get('dataSource').liveScore
  return `https://${host}/api-client/matches/events.json?match_id=${encodeURIComponent(String(match.id))}`
}

async function fetchMatchEvents (match: LiveMatch, liveCreds: LiveCreds, fetcher: typeof fetch = fetch): Promise<MatchEventsResult> {
  if (!(await canMakeExternalRequest())) {
    logger.warn('events fetch skipped for match id=%s: daily request cap reached', match.id)
    return { events: [], failed: true }
  }

  const url = appendCredsToUrl(eventsUrlFor(match), liveCreds?.key, liveCreds?.secret)
  logger.debug('events requesting %s', maskSecret(url))
  const res = await issueRequest(fetcher, url, `events for match id=${match.id}`)
  if (!res) { return { events: [], failed: true } }

  try {
    const json = await res.json()
    const events: RawEvent[] = json?.data?.event || json?.data?.events || []
    const ordered = orderEvents(events)
    const mapped = mapGoalEvents(ordered, match)
    logger.debug('events parsed for match id=%s count=%d', match.id, mapped.length)
    return { events: mapped, failed: false }
  } catch (err) {
    logger.warn('events parse error for match id=%s: %s', match.id, (err as Error)?.message || err)
    return { events: [], failed: true }
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
  if (e?.is_home === true) { return 'h' }
  if (e?.is_away === true) { return 'a' }
  const sideRaw = (e?.home_away || e?.side || e?.team || '').toString().toLowerCase()
  if (sideRaw.startsWith('h')) { return 'h' }
  if (sideRaw.startsWith('a')) { return 'a' }
  return null
}

function nameOf (ref: NamedRef | undefined): string {
  if (!ref) { return '' }
  if (typeof ref === 'string') { return ref }
  return (ref.name || '').toString()
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

// Intentionally excludes PENALTY_SHOOTOUT_GOAL - shootout kicks don't count towards the league.
function isLikelyGoalEvent (e: RawEvent): boolean {
  const eventType = (e?.event || '').toString().toUpperCase()
  return ['GOAL', 'GOAL_PENALTY', 'OWN_GOAL'].includes(eventType)
}

function getGoalScorer (e: RawEvent): string {
  const baseScorer = nameOf(e?.scorer) || nameOf(e?.player) || e?.player_name || e?.name || 'Unknown'
  const eventType = (e?.event || '').toString().toUpperCase()

  if (eventType === 'OWN_GOAL') {
    return `${baseScorer} OG`
  }

  return baseScorer
}

function getAssist (e: RawEvent): string | null {
  return nameOf(e?.assist) || e?.assist_name || nameOf(e?.info) || null
}
