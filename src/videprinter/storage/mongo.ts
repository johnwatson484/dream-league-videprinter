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
  const ops = events.map(e => ({ updateOne: { filter: { id: e.id }, update: { $setOnInsert: e }, upsert: true } }))
  try {
    await collection.bulkWrite(ops, { ordered: false })
  } catch (err) {
    defaultLogger.error('[mongo] bulkWrite error: %s', (err as Error).message)
  }
}

export async function fetchRecentEvents (limit = 100): Promise<GoalEvent[]> {
  if (!collection) { return [] }
  const docs = await collection.find({}, { projection: { _id: 0 } })
    .sort({ utcTimestamp: -1 })
    .limit(limit)
    .toArray()
  return docs as unknown as GoalEvent[]
}

export async function fetchEventsByDateRange (from: Date, to: Date): Promise<GoalEvent[]> {
  if (!collection) { return [] }
  const docs = await collection.find(
    { utcTimestamp: { $gte: from, $lte: to } } as any,
    { projection: { _id: 0 } }
  ).sort({ utcTimestamp: -1 }).toArray()
  return docs as unknown as GoalEvent[]
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

export async function batchCheckEventExists (eventIds: string[] = []): Promise<Set<string>> {
  if (!collection || !eventIds.length) { return new Set() }
  try {
    const existingDocs = await collection.find(
      { id: { $in: eventIds } } as any,
      { projection: { id: 1, _id: 0 } }
    ).toArray()
    return new Set(existingDocs.map(doc => (doc as unknown as { id: string }).id))
  } catch (err) {
    defaultLogger.error('[mongo] batchCheckEventExists error: %s', (err as Error).message)
    return new Set()
  }
}

export async function closeMongo (): Promise<void> {
  if (client) { await client.close() }
}
