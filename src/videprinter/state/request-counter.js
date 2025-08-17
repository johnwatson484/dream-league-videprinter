// Persistent (Mongo-backed when available) daily request counter.
// Falls back to in-memory if Mongo disabled.
import config from '../../config.js'
import { getMetaStore, upsertMeta } from '../storage/meta-store.js'

let dateKey = new Date().toISOString().slice(0, 10)
let count = 0
let loaded = false

async function ensureLoaded () {
  if (loaded) return
  const store = getMetaStore()
  if (!store) { loaded = true; return }
  const doc = await store.findOne({ _id: 'dailyRequestCounter' })
  if (doc) {
    if (doc.dateKey === dateKey) {
      count = doc.count || 0
    } else {
      // new day -> reset persisted
      count = 0
      dateKey = new Date().toISOString().slice(0, 10)
      await upsertMeta('dailyRequestCounter', { dateKey, count })
    }
  } else {
    await upsertMeta('dailyRequestCounter', { dateKey, count })
  }
  loaded = true
}

export async function noteExternalRequest () {
  await ensureLoaded()
  const today = new Date().toISOString().slice(0, 10)
  if (today !== dateKey) {
    dateKey = today
    count = 0
  }
  count++
  const store = getMetaStore()
  if (store) await upsertMeta('dailyRequestCounter', { dateKey, count })
  return count
}

export async function canMakeExternalRequest () {
  await ensureLoaded()
  const cap = config.get('dataSource').dailyRequestCap || Infinity
  return count < cap
}

export async function remainingRequestsToday () {
  await ensureLoaded()
  const cap = config.get('dataSource').dailyRequestCap || Infinity
  return cap === Infinity ? Infinity : Math.max(0, cap - count)
}

export function currentRequestCount () { return count }

// Non-async compatibility wrappers (legacy code may import sync names)
export function noteExternalRequestSync () { return noteExternalRequest() }
export function canMakeExternalRequestSync () { return count < (config.get('dataSource').dailyRequestCap || Infinity) }
export function remainingRequestsTodaySync () { const cap = config.get('dataSource').dailyRequestCap || Infinity; return cap === Infinity ? Infinity : Math.max(0, cap - count) }
