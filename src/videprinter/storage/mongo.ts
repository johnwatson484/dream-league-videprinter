import type { Collection, MongoClient as MongoClientType } from 'mongodb'
import { MongoClient } from 'mongodb'
import type { GoalEvent } from '../types.ts'
import type { Logger } from 'pino'
import config from '../../config.ts'
import defaultLogger from '../../logger.ts'
import { registerMetaCollection } from './meta-store.ts'
import { initMatchCollection } from './match-store.ts'

let client: MongoClientType | undefined
let collection: Collection<GoalEvent> | undefined

export async function initMongo (logger: Logger = defaultLogger): Promise<boolean> {
  const mongoCfg = config.get('mongo')
  if (!mongoCfg.enabled || !mongoCfg.uri) {
    logger.info('[mongo] disabled')
    return false
  }
  client = new MongoClient(mongoCfg.uri)
  await client.connect()
  const db = client.db(mongoCfg.dbName)
  collection = db.collection<GoalEvent>(mongoCfg.collection)
  await collection.createIndex({ id: 1 }, { unique: true })
  await collection.createIndex({ fixtureId: 1 })
  await collection.createIndex({ utcTimestamp: -1 })
  if (await collection.indexExists('utcTimestamp_1')) {
    await collection.dropIndex('utcTimestamp_1')
  }
  await collection.createIndex({ utcTimestamp: 1 }, { expireAfterSeconds: 1209600 })
  registerMetaCollection(db)
  await initMatchCollection(db)
  logger.info('[mongo] connected')
  return true
}

export async function saveEvents (events: GoalEvent[] = []): Promise<void> {
  if (!collection || !events.length) { return }
  // Only the identity fields are immutable; everything else can be corrected by the provider
  // between polls, so it is always overwritten rather than set once on insert.
  const ops = events.map(({ id, fixtureId, competition, source, potentialGoalFor, potentialConcedingFor, ...mutable }) => ({
    updateOne: {
      filter: { id },
      update: {
        $setOnInsert: { id, fixtureId, competition, source },
        $set: { ...mutable, potentialGoalFor: potentialGoalFor ?? null, potentialConcedingFor: potentialConcedingFor ?? null },
      },
      upsert: true,
    },
  }))
  try {
    await collection.bulkWrite(ops as any, { ordered: false })
  } catch (err) {
    defaultLogger.error('[mongo] bulkWrite error: %s', (err as Error).message)
  }
}

// Soft-delete: keeps the doc (and its history) around for audit, but hidden from every read below.
export async function retractEvents (eventIds: string[] = []): Promise<void> {
  if (!collection || !eventIds.length) { return }
  try {
    await collection.updateMany(
      { id: { $in: eventIds } } as any,
      { $set: { retracted: true, retractedAt: new Date() } }
    )
  } catch (err) {
    defaultLogger.error('[mongo] retractEvents error: %s', (err as Error).message)
  }
}

export async function fetchRecentEvents (limit = 100): Promise<GoalEvent[]> {
  if (!collection) { return [] }
  const docs = await collection.find({ retracted: { $ne: true } } as any, { projection: { _id: 0 } })
    .sort({ utcTimestamp: -1 })
    .limit(limit)
    .toArray()
  return docs as unknown as GoalEvent[]
}

export async function fetchAllEvents (): Promise<GoalEvent[]> {
  if (!collection) { return [] }
  const docs = await collection.find({ retracted: { $ne: true } } as any, { projection: { _id: 0 } })
    .sort({ utcTimestamp: -1 })
    .toArray()
  return docs as unknown as GoalEvent[]
}

export async function fetchEventsByDateRange (from: Date, to: Date): Promise<GoalEvent[]> {
  if (!collection) { return [] }
  const docs = await collection.find(
    { utcTimestamp: { $gte: from, $lte: to }, retracted: { $ne: true } } as any,
    { projection: { _id: 0 } }
  ).sort({ utcTimestamp: -1 }).toArray()
  return docs as unknown as GoalEvent[]
}

// All still-active (non-retracted) goals recorded for a fixture, used to spot corrections
// (same id, changed content) and retractions (an id that no longer appears in the live snapshot).
export async function fetchActiveEventsForFixture (fixtureId: string): Promise<GoalEvent[]> {
  if (!collection) { return [] }
  try {
    const docs = await collection.find(
      { fixtureId, retracted: { $ne: true } } as any,
      { projection: { _id: 0 } }
    ).toArray()
    return docs as unknown as GoalEvent[]
  } catch (err) {
    defaultLogger.error('[mongo] fetchActiveEventsForFixture error: %s', (err as Error).message)
    return []
  }
}

export async function eventExists (eventId: string): Promise<boolean> {
  if (!collection) { return false }
  try {
    const count = await collection.countDocuments({ id: eventId } as any, { limit: 1 })
    return count > 0
  } catch (err) {
    defaultLogger.error('[mongo] eventExists error: %s', (err as Error).message)
    return false
  }
}

export async function closeMongo (): Promise<void> {
  if (client) { await client.close() }
}
