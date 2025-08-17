import { MongoClient } from 'mongodb'
import config from '../../config.js'
import { registerMetaCollection } from './meta-store.js'

let client
let collection

export async function initMongo (logger = console) {
  const safeLog = (msg, ...rest) => {
    try {
      if (logger && typeof logger.info === 'function') return logger.info(msg, ...rest)
      if (logger && typeof logger.log === 'function') return logger.log(msg, ...rest)
      return console.log(msg, ...rest)
    } catch { console.log(msg, ...rest) }
  }
  const mongoCfg = config.get('mongo')
  if (!mongoCfg.enabled || !mongoCfg.uri) {
    safeLog('[mongo] disabled')
    return false
  }
  client = new MongoClient(mongoCfg.uri)
  await client.connect()
  const db = client.db(mongoCfg.dbName)
  collection = db.collection(mongoCfg.collection)
  await collection.createIndex({ id: 1 }, { unique: true })
  await collection.createIndex({ utcTimestamp: -1 })
  // Register meta collection (for request counter & misc small docs)
  registerMetaCollection(db)
  safeLog('[mongo] connected')
  return true
}

export async function saveEvents (events = [], logger = console) {
  if (!collection || !events.length) return
  const ops = events.map(e => ({ updateOne: { filter: { id: e.id }, update: { $setOnInsert: e }, upsert: true } }))
  try {
    await collection.bulkWrite(ops, { ordered: false })
  } catch (err) {
    logger.error('[mongo] bulkWrite error', err.message)
  }
}

export async function fetchRecentEvents (limit = 100) {
  if (!collection) return []
  const docs = await collection.find({}, { projection: { _id: 0 } }).sort({ utcTimestamp: -1 }).limit(limit).toArray()
  return docs
}

export async function closeMongo () {
  if (client) await client.close()
}
