// Throwaway diagnostic: dumps the raw LiveScore payloads so the real shape of
// matches/live.json and the per-match events endpoint can be confirmed against the docs.
// Usage: npm run probe:live-score (reads LIVE_SCORE_KEY/LIVE_SCORE_SECRET from .env or env vars)
import config from '../src/config.ts'

function maskSecret (url: string): string { return url.replace(/secret=[^&]*/i, 'secret=***') }

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

async function main (): Promise<void> {
  const { host, key, secret } = config.get('dataSource').liveScore
  if (!key || !secret) {
    console.error('LIVE_SCORE_KEY / LIVE_SCORE_SECRET are not set')
    process.exitCode = 1
    return
  }

  const liveUrl = `https://${host}/api-client/matches/live.json?key=${encodeURIComponent(key)}&secret=${encodeURIComponent(secret)}`
  console.log('GET', maskSecret(liveUrl))
  const liveRes = await fetch(liveUrl)
  const liveJson = await liveRes.json()
  console.log(JSON.stringify(liveJson, null, 2))

  const matches = liveJson?.data?.match
  if (!Array.isArray(matches) || !matches.length) {
    console.log('no live matches right now - nothing to follow up with')
    return
  }

  const matchWithGoals = matches.find((m: any) => /\d+\s*-\s*\d+/.test(m?.scores?.score || '') && m.scores.score !== '0 - 0') || matches[0]
  const eventsUrl = appendCredsToUrl(matchWithGoals?.urls?.events, key, secret)
  if (!eventsUrl) {
    console.log('selected match has no urls.events link')
    return
  }

  console.log('\nGET', maskSecret(eventsUrl))
  const eventsRes = await fetch(eventsUrl)
  const eventsJson = await eventsRes.json()
  console.log(JSON.stringify(eventsJson, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
