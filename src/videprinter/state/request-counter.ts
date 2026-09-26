import config from '../../config.ts'
import { getMetaStore, upsertMeta } from '../storage/meta-store.ts'

let dateKey = new Date().toISOString().slice(0, 10)
let count = 0
let loaded = false
let dirty = false

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
  rollDate()
  count++
  dirty = true
  return count
}

// Persisting on every request put a Mongo round-trip in the fetch path, ~80 a cycle on a
// busy Saturday. The in-memory count is what the cap is checked against; the stored copy
// only has to survive a restart, so the poller flushes it once a cycle.
export async function persistRequestCount (): Promise<void> {
  if (!dirty) { return }
  dirty = false
  const store = getMetaStore()
  if (!store) { return }
  await upsertMeta('dailyRequestCounter', { dateKey, count })
}

// Every entry point has to roll the day, not just this one: the cap check is still
// reachable once the budget is spent, but noting a request is not, so leaving the roll
// there alone would strand the counter on a spent day for good.
function rollDate (): void {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== dateKey) {
    dateKey = today
    count = 0
    dirty = true
  }
}

export async function canMakeExternalRequest (): Promise<boolean> {
  await ensureLoaded()
  rollDate()
  const cap = config.get('dataSource').dailyRequestCap || Infinity
  return count < cap
}

export async function remainingRequestsToday (): Promise<number> {
  await ensureLoaded()
  rollDate()
  const cap = config.get('dataSource').dailyRequestCap || Infinity
  return cap === Infinity ? Infinity : Math.max(0, cap - count)
}
