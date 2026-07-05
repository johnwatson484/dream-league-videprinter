import { MongoClient } from 'mongodb'
import crypto from 'node:crypto'

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017'
const DB_NAME = process.env.MONGO_DBNAME || 'dream-league-videprinter'
const COLLECTION = process.env.MONGO_COLLECTION || 'goalEvents'

const EVENTS = [
  { scorer: 'Brown', scoringTeam: 'Barnsley', concedingTeam: 'Bolton', minute: 23, competition: 'Championship', dayOffset: 0 },
  { scorer: 'Brown', scoringTeam: 'Barnsley', concedingTeam: 'Reading', minute: 5, competition: 'Championship', dayOffset: 0 },
  { scorer: 'Smith', scoringTeam: 'Reading', concedingTeam: 'Derby', minute: 45, competition: 'Championship', dayOffset: 1 },
  { scorer: 'Taylor', scoringTeam: 'Charlton', concedingTeam: 'Exeter', minute: 67, competition: 'League One', dayOffset: 1 },
  { scorer: 'Evans', scoringTeam: 'Derby', concedingTeam: 'Blackpool', minute: 12, competition: 'Championship', dayOffset: 2 },
  { scorer: 'Evans', scoringTeam: 'Portsmouth', concedingTeam: 'Wigan', minute: 55, competition: 'League One', dayOffset: 2 },
  { scorer: 'Johnson', scoringTeam: 'Bolton', concedingTeam: 'Peterborough', minute: 33, competition: 'League One', dayOffset: 3 },
  { scorer: 'Jones', scoringTeam: 'Oxford', concedingTeam: 'Lincoln', minute: 78, competition: 'League One', dayOffset: 3 },
  { scorer: 'Taylor', scoringTeam: 'Exeter', concedingTeam: 'Charlton', minute: 90, competition: 'League Two', dayOffset: 4 },
  { scorer: 'Smith', scoringTeam: 'Lincoln', concedingTeam: 'Oxford', minute: 61, competition: 'League Two', dayOffset: 4 },
  { scorer: 'Evans', scoringTeam: 'Wigan', concedingTeam: 'Portsmouth', minute: 14, competition: 'League One', dayOffset: 5 },
  { scorer: 'Brown', scoringTeam: 'Exeter', concedingTeam: 'Peterborough', minute: 72, competition: 'League Two', dayOffset: 5 },
  { scorer: 'Johnson', scoringTeam: 'Bolton', concedingTeam: 'Charlton', minute: 38, competition: 'League One', dayOffset: 5 },
  { scorer: 'Smith', scoringTeam: 'Reading', concedingTeam: 'Blackpool', minute: 82, competition: 'Championship', dayOffset: 6 },
  { scorer: 'Jones', scoringTeam: 'Oxford', concedingTeam: 'Barnsley', minute: 19, competition: 'League One', dayOffset: 6 },
  { scorer: 'Taylor', scoringTeam: 'Charlton', concedingTeam: 'Lincoln', minute: 44, competition: 'League One', dayOffset: 6 },
  { scorer: 'Brown', scoringTeam: 'Barnsley', concedingTeam: 'Wigan', minute: 57, competition: 'Championship', dayOffset: 0 },
  { scorer: 'Evans', scoringTeam: 'Derby', concedingTeam: 'Bolton', minute: 31, competition: 'Championship', dayOffset: 1 },
  { scorer: 'Smith', scoringTeam: 'Lincoln', concedingTeam: 'Peterborough', minute: 68, competition: 'League Two', dayOffset: 3 },
  { scorer: 'Taylor', scoringTeam: 'Exeter', concedingTeam: 'Derby', minute: 25, competition: 'League Two', dayOffset: 4 },
]

function getGameweekStart (): Date {
  const now = new Date()
  const day = now.getDay()
  const diff = (day + 2) % 7
  const friday = new Date(now)
  friday.setDate(now.getDate() - diff)
  friday.setHours(0, 0, 0, 0)
  return friday
}

async function seed (): Promise<void> {
  const gameweekStart = getGameweekStart()
  console.log(`Seeding events for gameweek starting: ${gameweekStart.toISOString()}`)

  const client = new MongoClient(MONGO_URI)
  await client.connect()
  const db = client.db(DB_NAME)
  const collection = db.collection(COLLECTION)

  await collection.createIndex({ id: 1 }, { unique: true })
  await collection.createIndex({ utcTimestamp: -1 })
  await collection.createIndex({ utcTimestamp: 1 }, { expireAfterSeconds: 1209600 })

  const documents = EVENTS.map((event, index) => {
    const timestamp = new Date(gameweekStart)
    timestamp.setDate(timestamp.getDate() + event.dayOffset)
    timestamp.setHours(15 + Math.floor(index / 5), (index * 7) % 60, 0, 0)

    return {
      id: `seed-${index}-${event.minute}-${crypto.randomUUID()}`,
      fixtureId: `seed-fixture-${index}`,
      competition: event.competition,
      utcTimestamp: timestamp,
      minute: event.minute,
      scoringTeam: { name: event.scoringTeam },
      concedingTeam: { name: event.concedingTeam },
      scorer: { name: event.scorer, normalizedName: event.scorer.toLowerCase() },
      assist: null,
      scoreAfterEvent: { home: 1, away: 0 },
      phase: 'FT',
      source: 'seed',
    }
  })

  const result = await collection.bulkWrite(
    documents.map(doc => ({
      updateOne: { filter: { id: doc.id }, update: { $setOnInsert: doc }, upsert: true }
    })),
    { ordered: false }
  )

  console.log(`Inserted ${result.upsertedCount} events (${result.matchedCount} already existed)`)
  console.log(`Date range: ${documents[0]!.utcTimestamp.toISOString()} to ${documents[documents.length - 1]!.utcTimestamp.toISOString()}`)
  await client.close()
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
