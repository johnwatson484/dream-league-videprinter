import config from '../../config.ts'
import { getMetaStore, upsertMeta } from '../storage/meta-store.ts'

let dateKey = new Date().toISOString().slice(0, 10)
let count = 0
let loaded = false

async function ensureLoaded (): Promise<void> {
  if (loaded) { return }
  const store = getMetaStore()
  if (!store) { loaded = true; return }
  const doc = await store.findOne({ _id: 'dailyRequestCounter' } as any) as { dateKey: string; count: number } | null
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

export async function noteExternalRequest (): Promise<number> {
  await ensureLoaded()
  const today = new Date().toISOString().slice(0, 10)
  if (today !== dateKey) {
    dateKey = today
    count = 0
  }
  count++
  const store = getMetaStore()
  if (store) { await upsertMeta('dailyRequestCounter', { dateKey, count }) }
  return count
}

export async function canMakeExternalRequest (): Promise<boolean> {
  await ensureLoaded()
  const cap = config.get('dataSource').dailyRequestCap || Infinity
  return count < cap
}

export async function remainingRequestsToday (): Promise<number> {
  await ensureLoaded()
  const cap = config.get('dataSource').dailyRequestCap || Infinity
  return cap === Infinity ? Infinity : Math.max(0, cap - count)
}

export function currentRequestCount (): number { return count }

export function noteExternalRequestSync (): Promise<number> { return noteExternalRequest() }
export function canMakeExternalRequestSync (): boolean { return count < (config.get('dataSource').dailyRequestCap || Infinity) }
export function remainingRequestsTodaySync (): number { const cap = config.get('dataSource').dailyRequestCap || Infinity; return cap === Infinity ? Infinity : Math.max(0, cap - count) }
