// One-off migration from positional goal ids (`${fixtureId}-${side}-${ordinal}`) to the
// provider-backed scheme (`${fixtureId}-${providerEventId}`).
//
// Without it, the first poll after deploying the new id scheme mints a second document for
// every goal already stored, so the videprinter's history shows each of them twice until the
// 14-day TTL ages the old ones out.
//
// Stored goals are matched to their rebuilt counterparts by content signature (scorer,
// minute, score, assist, phase), so a goal the provider has since corrected will not match
// and is reported rather than guessed at.
//
//   node --env-file-if-exists=.env scripts/migrate-goal-ids.ts            # dry run
//   node --env-file-if-exists=.env scripts/migrate-goal-ids.ts --apply    # write
import { MongoClient } from 'mongodb'
import config from '../src/config.ts'
import { contentSignatureFor } from '../src/videprinter/aggregation/event-signature.ts'
import { rebuildGoalsForFixture } from '../src/videprinter/fetchers/live-score.ts'
import type { GoalEvent } from '../src/videprinter/types.ts'

const apply = process.argv.includes('--apply')
const LEGACY_ID = /-(?:h|a|unknown:.+)-\d+$/

interface Plan {
  fixtureId: string
  oldId: string
  newId: string
}

function groupByFixture (events: GoalEvent[]): Map<string, GoalEvent[]> {
  const byFixture = new Map<string, GoalEvent[]>()
  for (const event of events) {
    const bucket = byFixture.get(event.fixtureId)
    if (bucket) { bucket.push(event) } else { byFixture.set(event.fixtureId, [event]) }
  }
  return byFixture
}

async function planFixture (fixtureId: string, stored: GoalEvent[]): Promise<{ plans: Plan[]; unmatched: GoalEvent[] }> {
  const rebuilt = await rebuildGoalsForFixture(fixtureId)
  const bySignature = new Map(rebuilt.map(goal => [contentSignatureFor(goal), goal.id]))

  const plans: Plan[] = []
  const unmatched: GoalEvent[] = []
  for (const event of stored) {
    const newId = bySignature.get(contentSignatureFor(event))
    if (!newId || newId === event.id) {
      unmatched.push(event)
      continue
    }
    plans.push({ fixtureId, oldId: event.id, newId })
  }
  return { plans, unmatched }
}

async function main (): Promise<void> {
  const mongoCfg = config.get('mongo')
  if (!mongoCfg.enabled || !mongoCfg.uri) {
    console.error('mongo is not enabled; nothing to migrate')
    process.exitCode = 1
    return
  }

  const client = new MongoClient(mongoCfg.uri)
  await client.connect()
  const collection = client.db(mongoCfg.dbName).collection<GoalEvent>(mongoCfg.collection)

  try {
    const stored = await collection.find({}, { projection: { _id: 0 } }).toArray()
    const legacy = stored.filter(event => LEGACY_ID.test(event.id))
    console.log(`${stored.length} stored event(s), ${legacy.length} on the legacy id scheme`)
    if (!legacy.length) { return }

    const byFixture = groupByFixture(legacy)
    console.log(`${byFixture.size} fixture(s) to rebuild from the provider`)

    const plans: Plan[] = []
    const unmatched: GoalEvent[] = []
    for (const [fixtureId, events] of byFixture) {
      const result = await planFixture(fixtureId, events)
      plans.push(...result.plans)
      unmatched.push(...result.unmatched)
    }

    for (const plan of plans) {
      console.log(`  ${plan.oldId} -> ${plan.newId}`)
    }
    for (const event of unmatched) {
      console.warn(`  UNMATCHED ${event.id} (${event.scorer.name}, ${event.minute}') - left as is, will be re-created under a new id`)
    }

    if (!apply) {
      console.log(`\ndry run: ${plans.length} would be remapped, ${unmatched.length} unmatched. Re-run with --apply to write.`)
      return
    }

    let migrated = 0
    for (const plan of plans) {
      // Delete any doc already holding the target id: a poll on the new scheme may have
      // created one already, and it would otherwise collide with the unique index on `id`.
      await collection.deleteOne({ id: plan.newId, fixtureId: plan.fixtureId } as never)
      const result = await collection.updateOne({ id: plan.oldId } as never, { $set: { id: plan.newId } })
      migrated += result.modifiedCount
    }
    console.log(`\nmigrated ${migrated} event(s), ${unmatched.length} unmatched`)
  } finally {
    await client.close()
  }
}

await main()
