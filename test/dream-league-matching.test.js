import { FuzzyMatcher } from '../src/videprinter/matching/fuzzy-matcher.js'

describe('FuzzyMatcher', () => {
  let fuzzyMatcher

  beforeEach(() => {
    fuzzyMatcher = new FuzzyMatcher()

    // Mock Dream League data
    const players = [
      {
        playerId: 2537,
        name: 'Allen, Taylor',
        position: 'Defender',
        team: 'Wycombe Wanderers',
        manager: 'Billy Gordon',
        substitute: false
      },
      {
        playerId: 367,
        name: 'McCrorie, Ross',
        position: 'Defender',
        team: 'Bristol City',
        manager: 'Billy Gordon',
        substitute: false
      },
      {
        playerId: 282,
        name: 'Fletcher, Ashley',
        position: 'Forward',
        team: 'Blackpool',
        manager: 'Billy Gordon',
        substitute: false
      }
    ]

    const goalkeepers = [
      {
        teamId: 18,
        name: 'Blackburn Rovers',
        manager: 'Billy Gordon',
        substitute: false
      },
      {
        teamId: 58,
        name: 'Notts County',
        manager: 'Billy Gordon',
        substitute: true
      },
      {
        teamId: 5,
        name: 'Luton Town',
        manager: 'Bob Brown',
        substitute: false
      }
    ]

    fuzzyMatcher.updateData(players, goalkeepers)
  })

  test('finds exact player name matches', () => {
    const matches = fuzzyMatcher.findPlayerMatches('Fletcher, Ashley', 'Blackpool')

    expect(matches).toHaveLength(1)
    expect(matches[0].player.name).toBe('Fletcher, Ashley')
    expect(matches[0].player.manager).toBe('Billy Gordon')
    expect(matches[0].confidence).toBeGreaterThan(0.8)
  })

  test('finds fuzzy player name matches', () => {
    const matches = fuzzyMatcher.findPlayerMatches('Ashley Fletcher', 'Blackpool')

    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].player.name).toBe('Fletcher, Ashley')
    expect(matches[0].confidence).toBeGreaterThan(0.3)
  })

  test('filters by team when provided', () => {
    const matches = fuzzyMatcher.findPlayerMatches('Ashley Fletcher', 'Bristol City')

    // Should not match Fletcher from Blackpool when looking at Bristol City
    expect(matches).toHaveLength(0)
  })

  test('finds goalkeeper team matches', () => {
    const matches = fuzzyMatcher.findGoalkeeperMatches('Blackburn Rovers')

    expect(matches).toHaveLength(1)
    expect(matches[0].team.name).toBe('Blackburn Rovers')
    expect(matches[0].team.manager).toBe('Billy Gordon')
  })

  test('handles fuzzy team name matching', () => {
    const matches = fuzzyMatcher.findGoalkeeperMatches('Blackburn')

    expect(matches).toHaveLength(1)
    expect(matches[0].team.name).toBe('Blackburn Rovers')
  })

  test('normalizes names correctly', () => {
    expect(fuzzyMatcher.normalizeName('Arsenal FC')).toBe('arsenal')
    expect(fuzzyMatcher.normalizeName('Manchester United')).toBe('manchester')
    expect(fuzzyMatcher.normalizeName('Brighton & Hove Albion')).toBe('brighton hove')
  })

  test('team matching works with normalized names', () => {
    expect(fuzzyMatcher.isTeamMatch('Arsenal', 'Arsenal FC')).toBe(true)
    expect(fuzzyMatcher.isTeamMatch('Manchester United', 'Manchester Utd')).toBe(true)
    expect(fuzzyMatcher.isTeamMatch('Arsenal', 'Chelsea')).toBe(false)
  })

  test('returns summary correctly', () => {
    const summary = fuzzyMatcher.getSummary()

    expect(summary.playersLoaded).toBe(3)
    expect(summary.goalkeepersLoaded).toBe(3)
    expect(summary.uniqueManagers).toBe(2) // Billy Gordon and Bob Brown
  })
})
