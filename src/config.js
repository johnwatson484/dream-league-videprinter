import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

convict.addFormats(convictFormatWithValidator)

const config = convict({
  env: {
    doc: 'The application environment.',
    format: ['production', 'development', 'test'],
    default: 'development',
    env: 'NODE_ENV',
  },
  isDev: {
    doc: 'True if the application is in development mode.',
    format: Boolean,
    default: process.env.NODE_ENV === 'development',
  },
  host: {
    doc: 'The host to bind.',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST',
  },
  port: {
    doc: 'The port to bind.',
    format: 'port',
    default: 3002,
    env: 'PORT',
    arg: 'port',
  },
  appName: {
    doc: 'The name of the application.',
    format: String,
    default: 'Dream League Videprinter',
    env: 'APP_NAME',
  },
  videprinter: {
    doc: 'Videprinter feature configuration',
    format: Object,
    default: {
      enabled: true,
      competitions: ['Championship', 'League One', 'League Two', 'FA Cup', 'League Cup'],
      pollLiveIntervalMs: 30020,
      pollIdleIntervalMs: 300200,
    },
  },
  dataSource: {
    doc: 'External football data source configuration',
    format: Object,
    default: {
      provider: 'mock', // 'mock' or 'live-score'
      liveScore: {
        host: 'livescore-api.com',
        key: '',
        secret: '',
        // Hard-coded LiveScore competition IDs used by both live provider and mock
        competitions: {
          championship: 77,
          leagueOne: 82,
          leagueTwo: 83,
          faCup: 152,
          leagueCup: 150,
        },
      },
      dailyRequestCap: 1000,
    },
  },
  ingest: {
    doc: 'Downstream API ingest endpoint for enriched events',
    format: Object,
    default: {
      url: '',
      token: '',
      batchSize: 20,
    },
  },
  mongo: {
    doc: 'MongoDB connection settings',
    format: Object,
    default: {
      uri: '', // e.g. mongodb://localhost:27017
      dbName: 'dream_league_videprinter',
      collection: 'goal_events',
      enabled: false,
    },
  },
})

// Development convenience: speed up mock polling so goals appear quickly
if (config.get('env') === 'development' && config.get('dataSource').provider === 'mock') {
  try {
    config.set('videprinter.pollLiveIntervalMs', 5000)
  } catch {}
}

// Environment override: USE_MOCK boolean (default true)
try {
  const mockEnv = process.env.USE_MOCK
  if (mockEnv !== undefined) {
    const mockFlag = /^(1|true|yes)$/i.test(mockEnv)
    config.set('dataSource.provider', mockFlag ? 'mock' : 'live-score')
  }
} catch {}
if (process.env.LIVE_SCORE_KEY) { try { config.set('dataSource.liveScore.key', process.env.LIVE_SCORE_KEY) } catch {} }
if (process.env.LIVE_SCORE_SECRET) { try { config.set('dataSource.liveScore.secret', process.env.LIVE_SCORE_SECRET) } catch {} }

// Derived convenience: flat competition ID set
try {
  const comps = config.get('dataSource.liveScore.competitions')
  config.set('dataSource.liveScore.competitionIdSet', new Set(Object.values(comps)))
} catch {}

config.validate({ allowed: 'strict' })

export default config
