import type { Collection, Db } from 'mongodb'
import type { MatchRecord } from '../types.ts'

let collection: Collection<MatchRecord> | undefined

export async function initMatchCollection (db: Db): Promise<void> {
  collection = db.collection<MatchRecord>('matches')
  await collection.createIndex({ fixtureId: 1 }, { unique: true })
  await collection.createIndex({ utcTimestamp: -1 })
  await collection.createIndex({ utcTimestamp: 1 }, { expireAfterSeconds: 1209600 })
}

export async function saveMatches (matches: MatchRecord[] = []): Promise<void> {
  if (!collection || !matches.length) { return }
  const ops = matches.map(m => ({
    updateOne: {
      filter: { fixtureId: m.fixtureId },
      update: {
        $setOnInsert: { fixtureId: m.fixtureId, homeTeam: m.homeTeam, awayTeam: m.awayTeam, competition: m.competition, utcTimestamp: m.utcTimestamp },
        $set: { status: m.status, finalScore: m.finalScore },
      },
      upsert: true,
    },
  }))
  try {
    await collection.bulkWrite(ops, { ordered: false })
  } catch (err) {
    console.error('[match-store] bulkWrite error', (err as Error).message)
  }
}

export async function fetchMatchesByDateRange (from: Date, to: Date): Promise<MatchRecord[]> {
  if (!collection) { return [] }
  const docs = await collection.find(
    { utcTimestamp: { $gte: from, $lte: to } } as any,
    { projection: { _id: 0 } }
  ).sort({ utcTimestamp: 1 }).toArray()
  return docs as unknown as MatchRecord[]
}
