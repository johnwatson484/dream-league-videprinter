import { MongoClient } from 'mongodb'
import crypto from 'node:crypto'

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017'
const DB_NAME = process.env.MONGO_DBNAME || 'dream-league-videprinter'
const COLLECTION = process.env.MONGO_COLLECTION || 'goalEvents'
const GAMEWEEK_START = process.env.GAMEWEEK_START || '2026-07-05'

const PLAYER_MATCHES: Record<string, { playerId: number; manager: string; player: string }> = {
  'Brown:Barnsley': { playerId: 1727, manager: 'John Watson', player: 'Brown, Jacob' },
  'Evans:Derby': { playerId: 1152, manager: 'Lee Gordon', player: 'Evans, George' },
  'Jones:Oxford': { playerId: 669, manager: 'Scott Dormand', player: 'Jones, Nico' },
  'Taylor:Charlton': { playerId: 1815, manager: 'Billy Gordon', player: 'Taylor, Lyle' },
  'Evans:Wigan': { playerId: 1696, manager: 'Tommy Gordon', player: 'Evans, Lee' },
  'Taylor:Exeter': { playerId: 1184, manager: 'David Brown', player: 'Taylor, Jake' },
  'Evans:Portsmouth': { playerId: 1485, manager: 'Bob Brown', player: 'Evans, Gareth' },
  'Smith:Reading': { playerId: 2065, manager: 'Darren Brown', player: 'Smith, Sam' },
  'Johnson:Bolton': { playerId: 292, manager: 'John Watson', player: 'Johnson, Chiori' },
  'Smith:Lincoln': { playerId: 563, manager: 'David Brown', player: 'Smith, Jon' },
}

const KEEPER_MATCHES: Record<string, { teamId: number; manager: string }> = {
  Barnsley: { teamId: 26, manager: 'John Watson' },
  Bolton: { teamId: 16, manager: 'Bob Brown' },
  Derby: { teamId: 33, manager: 'Lee Gordon' },
  Portsmouth: { teamId: 20, manager: 'Darren Brown' },
  Oxford: { teamId: 74, manager: 'Scott Dormand' },
  Blackpool: { teamId: 63, manager: 'Michael Richardson' },
  Peterborough: { teamId: 27, manager: 'Billy Gordon' },
  Charlton: { teamId: 24, manager: 'Rob Doloughan' },
  Wigan: { teamId: 28, manager: 'Tommy Gordon' },
  Reading: { teamId: 41, manager: 'Ben Scott' },
  Exeter: { teamId: 60, manager: 'David Brown' },
  Lincoln: { teamId: 6, manager: 'Tucker Brazier' },
}

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
  { scorer: 'Hardie', scoringTeam: 'Blackpool', concedingTeam: 'Peterborough', minute: 68, competition: 'League Two', dayOffset: 3 },
  { scorer: 'Pederson', scoringTeam: 'Birmingham', concedingTeam: 'Derby', minute: 4, competition: 'Championship', dayOffset: 4 },
]

async function seed (): Promise<void> {
  const gameweekStart = new Date(GAMEWEEK_START)
  gameweekStart.setUTCHours(0, 0, 0, 0)
  console.log(`Seeding events for gameweek starting: ${gameweekStart.toISOString()}`)

  const client = new MongoClient(MONGO_URI)
  await client.connect()
  const db = client.db(DB_NAME)
  const collection = db.collection(COLLECTION)

  await collection.createIndex({ id: 1 }, { unique: true })
  await collection.createIndex({ utcTimestamp: -1 })
  await collection.createIndex({ utcTimestamp: 1 }, { expireAfterSeconds: 1209600 })

  await collection.deleteMany({ source: 'seed' })

  const documents = EVENTS.map((event, index) => {
    const timestamp = new Date(gameweekStart)
    timestamp.setDate(timestamp.getDate() + event.dayOffset)
    timestamp.setUTCHours(15 + Math.floor(index / 5), (index * 7) % 60, 0, 0)

    const playerKey = `${event.scorer}:${event.scoringTeam}`
    const playerMatch = PLAYER_MATCHES[playerKey]
    const keeperMatch = KEEPER_MATCHES[event.concedingTeam]

    const doc: any = {
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

    if (playerMatch) {
      doc.potentialGoalFor = {
        manager: playerMatch.manager,
        player: playerMatch.player,
        playerId: playerMatch.playerId,
        team: event.scoringTeam,
        confidence: 0.95,
        substitute: false,
      }
    }

    if (keeperMatch) {
      doc.potentialConcedingFor = {
        manager: keeperMatch.manager,
        team: event.concedingTeam,
        teamId: keeperMatch.teamId,
        confidence: 0.90,
        substitute: false,
      }
    }

    return doc
  })

  const result = await collection.bulkWrite(
    documents.map(doc => ({
      updateOne: { filter: { id: doc.id }, update: { $setOnInsert: doc }, upsert: true }
    })),
    { ordered: false }
  )

  console.log(`Inserted ${result.upsertedCount} events (${result.matchedCount} already existed)`)
  const enriched = documents.filter(d => d.potentialGoalFor).length
  const unmatched = documents.filter(d => !d.potentialGoalFor).length
  console.log(`Enriched: ${enriched} with playerIds, ${unmatched} unmatched`)
  console.log(`Date range: ${documents[0]!.utcTimestamp.toISOString()} to ${documents[documents.length - 1]!.utcTimestamp.toISOString()}`)
  await client.close()
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
