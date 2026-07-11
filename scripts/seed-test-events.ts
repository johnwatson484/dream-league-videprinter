import { MongoClient } from 'mongodb'
import crypto from 'node:crypto'

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017'
const DB_NAME = process.env.MONGO_DBNAME || 'dream-league-videprinter'
const COLLECTION = process.env.MONGO_COLLECTION || 'goalEvents'
const GAMEWEEK_START = process.env.GAMEWEEK_START || '2026-07-05'

const PLAYER_MATCHES: Record<string, { playerId: number; manager: string; player: string }> = {
  'Moore:Barnsley': { playerId: 1730, manager: 'John Watson', player: 'Moore, Kieffer' },
  'Chaplin:Barnsley': { playerId: 1728, manager: 'Tucker Brazier', player: 'Chaplin, Conor' },
  'Taylor:Charlton': { playerId: 1815, manager: 'Tucker Brazier', player: 'Taylor, Lyle' },
  'Byrne:Wigan': { playerId: 1694, manager: 'John Watson', player: 'Byrne, Nathan' },
  'Kipre:Wigan': { playerId: 895, manager: 'Scott Dormand', player: 'Kipre, Cedric' },
  'Lawrence:Derby': { playerId: 1845, manager: 'Billy Gordon', player: 'Lawrence, Tom' },
  'Waghorn:Derby': { playerId: 1848, manager: 'Rob Doloughan', player: 'Waghorn, Martyn' },
  'Bennett:Derby': { playerId: 1843, manager: 'Rob Doloughan', player: 'Bennett, Mason' },
  'Hardie:Blackpool': { playerId: 1746, manager: 'Scott Dormand', player: 'Hardie, Ryan' },
  'Gnanduillet:Blackpool': { playerId: 1745, manager: 'Bob Brown', player: 'Gnanduillet, Armand' },
  'Cannon:Portsmouth': { playerId: 1482, manager: 'David Brown', player: 'Cannon, Andy' },
  'Bowman:Exeter': { playerId: 1861, manager: 'Ben Scott', player: 'Bowman, Ryan' },
  'Sweeney:Exeter': { playerId: 460, manager: 'John Watson', player: 'Sweeney, Pierce' },
  'Hall:Oxford': { playerId: 2014, manager: 'David Brown', player: 'Hall, Rob' },
  'Henry:Oxford': { playerId: 2015, manager: 'Billy Gordon', player: 'Henry, James' },
  'Toney:Peterborough': { playerId: 2027, manager: 'Lee Gordon', player: 'Toney, Ivan' },
  'Eisa:Peterborough': { playerId: 2022, manager: 'David Brown', player: 'Eisa, Mo' },
  'Boyd:Peterborough': { playerId: 1445, manager: 'Scott Dormand', player: 'Boyd, George' },
  'Andrade:Lincoln': { playerId: 1311, manager: 'Bob Brown', player: 'Andrade, Bruno' },
  'Kaikai:Blackpool': { playerId: 969, manager: 'Rob Doloughan', player: 'Kaikai, Sullay' },
}

const KEEPER_MATCHES: Record<string, { teamId: number; manager: string }> = {
  Wigan: { teamId: 28, manager: 'Lee Gordon' },
  Derby: { teamId: 33, manager: 'Michael Richardson' },
  Portsmouth: { teamId: 20, manager: 'Tucker Brazier' },
}

const EVENTS = [
  { scorer: 'Moore', scoringTeam: 'Barnsley', concedingTeam: 'Wigan', minute: 23, competition: 'Championship', dayOffset: 0 },
  { scorer: 'Moore', scoringTeam: 'Barnsley', concedingTeam: 'Derby', minute: 57, competition: 'Championship', dayOffset: 0 },
  { scorer: 'Chaplin', scoringTeam: 'Barnsley', concedingTeam: 'Portsmouth', minute: 5, competition: 'Championship', dayOffset: 0 },
  { scorer: 'Taylor', scoringTeam: 'Charlton', concedingTeam: 'Derby', minute: 67, competition: 'League One', dayOffset: 1 },
  { scorer: 'Lawrence', scoringTeam: 'Derby', concedingTeam: 'Wigan', minute: 12, competition: 'Championship', dayOffset: 1 },
  { scorer: 'Waghorn', scoringTeam: 'Derby', concedingTeam: 'Portsmouth', minute: 31, competition: 'Championship', dayOffset: 1 },
  { scorer: 'Hardie', scoringTeam: 'Blackpool', concedingTeam: 'Wigan', minute: 55, competition: 'Championship', dayOffset: 2 },
  { scorer: 'Gnanduillet', scoringTeam: 'Blackpool', concedingTeam: 'Derby', minute: 33, competition: 'Championship', dayOffset: 2 },
  { scorer: 'Cannon', scoringTeam: 'Portsmouth', concedingTeam: 'Derby', minute: 78, competition: 'League One', dayOffset: 3 },
  { scorer: 'Bowman', scoringTeam: 'Exeter', concedingTeam: 'Portsmouth', minute: 90, competition: 'League Two', dayOffset: 3 },
  { scorer: 'Hall', scoringTeam: 'Oxford', concedingTeam: 'Wigan', minute: 61, competition: 'League One', dayOffset: 4 },
  { scorer: 'Toney', scoringTeam: 'Peterborough', concedingTeam: 'Derby', minute: 14, competition: 'League One', dayOffset: 4 },
  { scorer: 'Toney', scoringTeam: 'Peterborough', concedingTeam: 'Wigan', minute: 38, competition: 'League One', dayOffset: 5 },
  { scorer: 'Boyd', scoringTeam: 'Peterborough', concedingTeam: 'Portsmouth', minute: 82, competition: 'League One', dayOffset: 5 },
  { scorer: 'Andrade', scoringTeam: 'Lincoln', concedingTeam: 'Derby', minute: 19, competition: 'League Two', dayOffset: 5 },
  { scorer: 'Byrne', scoringTeam: 'Wigan', concedingTeam: 'Portsmouth', minute: 44, competition: 'League One', dayOffset: 6 },
  { scorer: 'Kipre', scoringTeam: 'Wigan', concedingTeam: 'Derby', minute: 72, competition: 'League One', dayOffset: 6 },
  { scorer: 'Sweeney', scoringTeam: 'Exeter', concedingTeam: 'Wigan', minute: 25, competition: 'League Two', dayOffset: 6 },
  { scorer: 'Pederson', scoringTeam: 'Birmingham', concedingTeam: 'Derby', minute: 4, competition: 'Championship', dayOffset: 4 },
  { scorer: 'Grabban', scoringTeam: 'Nottingham Forest', concedingTeam: 'Wigan', minute: 68, competition: 'Championship', dayOffset: 3 },
]

async function seed (): Promise<void> {
  const gameweekStart = new Date(GAMEWEEK_START)
  gameweekStart.setUTCHours(0, 0, 0, 0)
  console.log(`Seeding events for gameweek starting: ${gameweekStart.toISOString().slice(0, 10)}`)

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

  console.log(`Seeded ${result.upsertedCount} events`)
  await client.close()
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
