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
    enabled: {
      doc: 'Enable videprinter feature',
      format: Boolean,
      default: true,
      env: 'VIDEPRINTER_ENABLED',
    },
    competitions: {
      doc: 'Human friendly competition names',
      format: Array,
      default: ['Championship', 'League One', 'League Two', 'FA Cup', 'League Cup'],
    },
    pollLiveIntervalMs: {
      doc: 'Polling interval (ms) when matches are live',
      format: 'nat',
      default: 30020,
      env: 'VIDEPRINTER_POLL_LIVE_MS',
    },
    pollIdleIntervalMs: {
      doc: 'Polling interval (ms) when idle',
      format: 'nat',
      default: 300200,
      env: 'VIDEPRINTER_POLL_IDLE_MS',
    },
  },
  dataSource: {
    provider: {
      doc: 'Resolved provider based on useMock flag',
      format: String,
      default: 'mock', // computed after load
    },
    useMock: {
      doc: 'Toggle mock provider (true) vs LiveScore (false)',
      format: Boolean,
      default: true,
      env: 'USE_MOCK',
    },
    dailyRequestCap: {
      doc: 'Max external requests per day',
      format: 'nat',
      default: 1000,
      env: 'DAILY_REQUEST_CAP',
    },
    liveScore: {
      host: {
        doc: 'LiveScore host',
        format: String,
        default: 'livescore-api.com',
        env: 'LIVE_SCORE_HOST',
      },
      key: {
        doc: 'LiveScore API key',
        format: String,
        default: '',
        env: 'LIVE_SCORE_KEY',
      },
      secret: {
        doc: 'LiveScore API secret',
        format: String,
        default: '',
        env: 'LIVE_SCORE_SECRET',
      },
      competitions: {
        doc: 'Hard-coded LiveScore competition IDs',
        format: Object,
        default: {
          championship: 77,
          leagueOne: 82,
          leagueTwo: 83,
          faCup: 152,
          leagueCup: 150,
        },
      },
    },
  },
  mongo: {
    uri: {
      doc: 'Mongo connection string',
      format: String,
      default: '',
      env: 'MONGO_URI',
    },
    dbName: {
      doc: 'Mongo database name',
      format: String,
      default: 'dream-league-videprinter',
      env: 'MONGO_DBNAME',
    },
    collection: {
      doc: 'Mongo collection for goal events',
      format: String,
      default: 'goal-events',
      env: 'MONGO_COLLECTION',
    },
    enabled: {
      doc: 'Enable Mongo persistence',
      format: Boolean,
      default: false,
      env: 'MONGO_ENABLED',
    },
  },
})

// Resolve provider based on useMock flag
try {
  const useMock = config.get('dataSource.useMock')
  config.set('dataSource.provider', useMock ? 'mock' : 'live-score')
} catch {}

// Development convenience: speed up mock polling so goals appear quickly
if (config.get('env') === 'development' && config.get('dataSource.useMock') === true) {
  try {
    config.set('videprinter.pollLiveIntervalMs', 5000)
  } catch {}
}
config.validate({ allowed: 'strict' })

export default config
