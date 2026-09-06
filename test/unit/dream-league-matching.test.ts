import type { DreamLeaguePlayer, DreamLeagueGoalkeeper } from '../../src/videprinter/types.ts'
import { FuzzyMatcher } from '../../src/videprinter/matching/fuzzy-matcher.ts'

describe('FuzzyMatcher', () => {
  let fuzzyMatcher: FuzzyMatcher

  beforeEach(() => {
    fuzzyMatcher = new FuzzyMatcher()

    const players: DreamLeaguePlayer[] = [
      {
        playerId: 2537,
        name: 'Allen, Taylor',
        position: 'Defender',
        team: 'Wycombe Wanderers',
        managerId: 1,
        manager: 'Billy Gordon',
        substitute: false
      },
      {
        playerId: 367,
        name: 'McCrorie, Ross',
        position: 'Defender',
        team: 'Bristol City',
        managerId: 1,
        manager: 'Billy Gordon',
        substitute: false
      },
      {
        playerId: 282,
        name: 'Fletcher, Ashley',
        position: 'Forward',
        team: 'Blackpool',
        managerId: 1,
        manager: 'Billy Gordon',
        substitute: false
      },
      {
        playerId: 999,
        name: 'Smith, John',
        position: 'Forward',
        team: 'Blackpool',
        managerId: 1,
        manager: 'Billy Gordon',
        substitute: true
      }
    ]

    const goalkeepers: DreamLeagueGoalkeeper[] = [
      {
        teamId: 18,
        name: 'Blackburn Rovers',
        managerId: 1,
        manager: 'Billy Gordon',
        substitute: false
      },
      {
        teamId: 58,
        name: 'Notts County',
        managerId: 1,
        manager: 'Billy Gordon',
        substitute: true
      },
      {
        teamId: 5,
        name: 'Luton Town',
        managerId: 2,
        manager: 'Bob Brown',
        substitute: false
      }
    ]

    fuzzyMatcher.updateData(players, goalkeepers)
  })

  test('finds exact player name matches', () => {
    const matches = fuzzyMatcher.findPlayerMatches('Fletcher, Ashley', 'Blackpool')

    expect(matches).toHaveLength(1)
    expect(matches[0]!.player.name).toBe('Fletcher, Ashley')
    expect(matches[0]!.player.manager).toBe('Billy Gordon')
    expect(matches[0]!.confidence).toBeGreaterThan(0.8)
  })

  test('finds fuzzy player name matches', () => {
    const matches = fuzzyMatcher.findPlayerMatches('Ashley Fletcher', 'Blackpool')

    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0]!.player.name).toBe('Fletcher, Ashley')
    expect(matches[0]!.confidence).toBeGreaterThan(0.3)
  })

  test('filters by team when provided', () => {
    const matches = fuzzyMatcher.findPlayerMatches('Ashley Fletcher', 'Bristol City')

    // Should not match Fletcher from Blackpool when looking at Bristol City
    expect(matches).toHaveLength(0)
  })

  test('finds goalkeeper team matches', () => {
    const matches = fuzzyMatcher.findGoalkeeperMatches('Blackburn Rovers')

    expect(matches).toHaveLength(1)
    expect(matches[0]!.team.name).toBe('Blackburn Rovers')
    expect(matches[0]!.team.manager).toBe('Billy Gordon')
  })

  test('handles fuzzy team name matching', () => {
    const matches = fuzzyMatcher.findGoalkeeperMatches('Blackburn')

    expect(matches).toHaveLength(1)
    expect(matches[0]!.team.name).toBe('Blackburn Rovers')
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

    expect(summary.playersLoaded).toBe(4)
    expect(summary.goalkeepersLoaded).toBe(3)
    expect(summary.uniqueManagers).toBe(2) // Billy Gordon and Bob Brown
  })

  test('excludes substitute players from matches', () => {
    // Try to find substitute player John Smith - should not return any matches
    const matches = fuzzyMatcher.findPlayerMatches('Smith, John', 'Blackpool')

    expect(matches).toHaveLength(0)
  })

  test('excludes substitute goalkeepers from matches', () => {
    // Try to find substitute goalkeeper Notts County - should not return any matches
    const matches = fuzzyMatcher.findGoalkeeperMatches('Notts County')

    expect(matches).toHaveLength(0)
  })

  test('includes non-substitute players in matches', () => {
    // Verify that non-substitute players are still found
    const matches = fuzzyMatcher.findPlayerMatches('Fletcher, Ashley', 'Blackpool')

    expect(matches).toHaveLength(1)
    expect(matches[0]!.player.substitute).toBe(false)
  })

  test('includes non-substitute goalkeepers in matches', () => {
    // Verify that non-substitute goalkeepers are still found
    const matches = fuzzyMatcher.findGoalkeeperMatches('Blackburn Rovers')

    expect(matches).toHaveLength(1)
    expect(matches[0]!.team.substitute).toBe(false)
  })
})

describe('FuzzyMatcher team matching for same-prefix clubs', () => {
  let fuzzyMatcher: FuzzyMatcher

  beforeEach(() => {
    fuzzyMatcher = new FuzzyMatcher()

    const goalkeepers: DreamLeagueGoalkeeper[] = [
      { teamId: 45, name: 'Sheffield United', alias: 'Sheff Utd', managerId: 1, manager: 'Alice', substitute: false },
      { teamId: 46, name: 'Sheffield Wednesday', alias: 'Sheff Wed', managerId: 2, manager: 'Bob', substitute: false },
      { teamId: 90, name: 'Bristol City', alias: 'Bristol City', managerId: 3, manager: 'Carl', substitute: false },
      { teamId: 91, name: 'Bristol Rovers', alias: 'Bristol Rovers', managerId: 4, manager: 'Dana', substitute: false },
    ]

    fuzzyMatcher.updateData([], goalkeepers)
  })

  test('does not confuse Sheffield United with Sheffield Wednesday', () => {
    const unitedMatches = fuzzyMatcher.findGoalkeeperMatches('Sheffield United')
    const wednesdayMatches = fuzzyMatcher.findGoalkeeperMatches('Sheffield Wednesday')

    expect(unitedMatches).toHaveLength(1)
    expect(unitedMatches[0]!.team.manager).toBe('Alice')
    expect(wednesdayMatches).toHaveLength(1)
    expect(wednesdayMatches[0]!.team.manager).toBe('Bob')
  })

  test('does not confuse Bristol City with Bristol Rovers', () => {
    const cityMatches = fuzzyMatcher.findGoalkeeperMatches('Bristol City')
    const roversMatches = fuzzyMatcher.findGoalkeeperMatches('Bristol Rovers')

    expect(cityMatches).toHaveLength(1)
    expect(cityMatches[0]!.team.manager).toBe('Carl')
    expect(roversMatches).toHaveLength(1)
    expect(roversMatches[0]!.team.manager).toBe('Dana')
  })

  test('matches on alias when the provider sends a shortened name', () => {
    const matches = fuzzyMatcher.findGoalkeeperMatches('Sheff Utd')

    expect(matches).toHaveLength(1)
    expect(matches[0]!.team.manager).toBe('Alice')
  })

  test('isTeamMatch does not conflate Sheffield United with Sheffield Wednesday', () => {
    expect(fuzzyMatcher.isTeamMatch('Sheffield United', 'Sheffield Wednesday')).toBe(false)
    expect(fuzzyMatcher.isTeamMatch('Bristol City', 'Bristol Rovers')).toBe(false)
  })
})
