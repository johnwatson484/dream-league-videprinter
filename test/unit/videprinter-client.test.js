// @vitest-environment jsdom
/* eslint-env browser */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/assets/js/videprinter.js'), 'utf8')

class FakeEventSource {
  static instances = []

  constructor (url) {
    this.url = url
    this.listeners = new Map()
    FakeEventSource.instances.push(this)
  }

  addEventListener (type, handler) {
    const existing = this.listeners.get(type) || []
    existing.push(handler)
    this.listeners.set(type, existing)
  }

  close () {}

  emit (type, data) {
    for (const handler of this.listeners.get(type) || []) {
      handler({ data: JSON.stringify(data) })
    }
  }
}

function goal (overrides = {}) {
  return {
    id: '1-100',
    fixtureId: '1',
    utcTimestamp: '2026-09-26T14:00:00.000Z',
    minute: 23,
    scoringTeam: { name: 'Leeds' },
    concedingTeam: { name: 'Derby' },
    homeTeam: 'Derby',
    awayTeam: 'Leeds',
    scorer: { name: 'Joel Piroe' },
    scoreAfterEvent: { home: 0, away: 1 },
    ...overrides
  }
}

function markup () {
  return `
    <button id="toggle-pause"></button>
    <span id="status"></span>
    <span id="filter-notice"></span>
    <input type="checkbox" id="toggle-all-goals">
    <ol id="videprinter"></ol>
    <div id="empty-state"></div>
  `
}

let history

async function start () {
  document.body.innerHTML = markup()
  FakeEventSource.instances.length = 0
  globalThis.EventSource = FakeEventSource
  globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ events: history }) }))

  // eslint-disable-next-line no-new-func
  new Function(source)()
  await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
  await new Promise(resolve => { setTimeout(resolve, 0) })

  return FakeEventSource.instances[0]
}

const rows = () => Array.from(document.querySelectorAll('#videprinter .videprinter-event'))
const visibleRows = () => rows().filter(li => !li.classList.contains('filtered-out'))
const text = li => li.textContent.replace(/\s+/g, ' ').trim()
const headings = () => Array.from(document.querySelectorAll('#videprinter .videprinter-day-heading')).map(text)
const matchedGoal = (overrides = {}) => goal({ potentialGoalFor: { manager: 'John', substitute: false }, ...overrides })

beforeEach(() => {
  history = []
  vi.useRealTimers()
})

describe('videprinter client rendering', () => {
  test('renders a goal pushed over the stream', async () => {
    const es = await start()
    es.emit('goal', goal({ potentialGoalFor: { manager: 'John', substitute: false } }))

    expect(rows()).toHaveLength(1)
    expect(text(rows()[0])).toBe("23'Derby vs Leeds 0-1Piroe, JGoal for John")
  })

  test('orders the fixture by the home and away teams the feed supplies, not by who is winning', async () => {
    const es = await start()
    // Home team leads 3-1 but the away team scored, which the old score comparison got backwards.
    es.emit('goal', goal({
      scoringTeam: { name: 'Leeds' },
      concedingTeam: { name: 'Derby' },
      homeTeam: 'Derby',
      awayTeam: 'Leeds',
      scoreAfterEvent: { home: 3, away: 1 },
      potentialGoalFor: { manager: 'John', substitute: false }
    }))

    const header = rows()[0].querySelector('.goal-header')
    expect(header.textContent).toContain('Derby')
    expect(header.querySelector('.scoring-team').textContent).toBe('Leeds')
  })

  test('escapes provider text rather than letting it become markup', async () => {
    const es = await start()
    es.emit('goal', goal({
      scorer: { name: '<img src=x onerror="alert(1)">, Ashley' },
      potentialGoalFor: { manager: '<script>alert(2)</script>', substitute: false }
    }))

    expect(document.querySelectorAll('#videprinter img')).toHaveLength(0)
    expect(document.querySelectorAll('#videprinter script')).toHaveLength(0)
    expect(rows()[0].querySelector('.goal-scorer').textContent).toBe('<img Src=x Onerror="alert(1)">, A')
  })
})

describe('videprinter match day headings', () => {
  test('groups history by day, newest first, with one heading for each visible day', async () => {
    history = [
      matchedGoal({ id: 'old', utcTimestamp: '2026-10-09T14:00:00.000Z' }),
      matchedGoal({ id: 'latest', utcTimestamp: '2026-10-10T15:00:00.000Z' }),
      matchedGoal({ id: 'earlier', utcTimestamp: '2026-10-10T14:00:00.000Z' })
    ]
    await start()

    expect(headings()).toEqual(['Saturday 10 October 2026', 'Friday 9 October 2026'])
    expect(rows().map(row => row.dataset.timestamp)).toEqual([
      '2026-10-10T15:00:00.000Z', '2026-10-10T14:00:00.000Z', '2026-10-09T14:00:00.000Z'
    ])
    expect(Array.from(document.querySelectorAll('#videprinter > li')).map(li => li.classList.contains('videprinter-day')))
      .toEqual([true, false, false, true, false])
    expect(document.querySelector('.videprinter-day time').dateTime).toBe('2026-10-10')
  })

  test.each([
    ['2026-08-15T23:30:00.000Z', 'Sunday 16 August 2026'],
    ['2026-12-15T23:30:00.000Z', 'Tuesday 15 December 2026'],
    ['2026-10-24T23:30:00.000Z', 'Sunday 25 October 2026'],
    ['2026-10-25T23:30:00.000Z', 'Sunday 25 October 2026']
  ])('uses the London calendar day for %s', async (utcTimestamp, expected) => {
    history = [matchedGoal({ utcTimestamp })]
    await start()

    expect(headings()).toEqual([expected])
  })

  test('keeps goals from a fixture crossing midnight in its kick-off day, behind the newer match day', async () => {
    const es = await start()
    es.emit('goal', matchedGoal({
      id: 'late-goal', utcTimestamp: '2026-12-16T00:45:00.000Z', matchUtcTimestamp: '2026-12-15T23:00:00.000Z'
    }))
    es.emit('goal', matchedGoal({
      id: 'new-day', utcTimestamp: '2026-12-16T00:30:00.000Z', matchUtcTimestamp: '2026-12-16T00:15:00.000Z'
    }))
    es.emit('goal', matchedGoal({
      id: 'early-goal', utcTimestamp: '2026-12-15T23:20:00.000Z', matchUtcTimestamp: '2026-12-15T23:00:00.000Z'
    }))

    expect(headings()).toEqual(['Wednesday 16 December 2026', 'Tuesday 15 December 2026'])
    expect(rows().map(row => row.dataset.timestamp)).toEqual([
      '2026-12-16T00:30:00.000Z', '2026-12-16T00:45:00.000Z', '2026-12-15T23:20:00.000Z'
    ])
  })

  test('hides empty day headings with the Dream League filter and restores them with all goals', async () => {
    history = [matchedGoal(), goal({ id: 'unmatched', utcTimestamp: '2026-09-25T14:00:00.000Z' })]
    await start()

    expect(headings()).toEqual(['Saturday 26 September 2026'])
    const toggle = document.getElementById('toggle-all-goals')
    toggle.checked = true
    toggle.dispatchEvent(new Event('change'))
    expect(headings()).toEqual(['Saturday 26 September 2026', 'Friday 25 September 2026'])
    toggle.checked = false
    toggle.dispatchEvent(new Event('change'))
    expect(headings()).toEqual(['Saturday 26 September 2026'])
  })

  test('removes a heading only when its final visible goal is retracted', async () => {
    history = [matchedGoal(), matchedGoal({ id: 'second' })]
    const es = await start()
    es.emit('goal-retracted', { id: '1-100' })
    expect(headings()).toEqual(['Saturday 26 September 2026'])

    es.emit('goal-retracted', { id: 'second' })
    expect(headings()).toEqual([])
    expect(document.getElementById('empty-state').style.display).toBe('block')
  })

  test('moves a goal to the correct day when only its kick-off date is corrected', async () => {
    const original = matchedGoal({ matchUtcTimestamp: '2026-09-26T13:30:00.000Z' })
    history = [original, matchedGoal({ id: 'other', utcTimestamp: '2026-09-25T14:00:00.000Z' })]
    const es = await start()
    es.emit('goal', { ...original, matchUtcTimestamp: '2026-09-24T13:30:00.000Z' })

    expect(headings()).toEqual(['Friday 25 September 2026', 'Thursday 24 September 2026'])
    expect(rows()).toHaveLength(2)
    expect(rows()[1].dataset.day).toBe('2026-09-24')
  })

  test('reorders an existing goal when only its goal timestamp changes', async () => {
    const original = matchedGoal()
    history = [original, matchedGoal({ id: 'other', utcTimestamp: '2026-09-26T15:00:00.000Z' })]
    const es = await start()
    es.emit('goal', { ...original, utcTimestamp: '2026-09-26T16:00:00.000Z' })

    expect(rows().map(row => row.dataset.timestamp)).toEqual(['2026-09-26T16:00:00.000Z', '2026-09-26T15:00:00.000Z'])
    expect(headings()).toEqual(['Saturday 26 September 2026'])
  })

  test('falls back to the goal date for an invalid kick-off and groups undated goals last', async () => {
    history = [
      matchedGoal({ matchUtcTimestamp: 'invalid' }),
      matchedGoal({ id: 'missing', utcTimestamp: null }),
      matchedGoal({ id: 'invalid', utcTimestamp: 'invalid' })
    ]
    await start()

    expect(headings()).toEqual(['Saturday 26 September 2026', 'Date unavailable'])
    expect(rows()[0].dataset.day).toBe('2026-09-26')
    expect(document.querySelectorAll('.videprinter-day time')).toHaveLength(1)
  })

  test('removes empty day headings on reconnect even when retained goals are unchanged', async () => {
    const retained = matchedGoal({ utcTimestamp: '2026-09-25T14:00:00.000Z' })
    history = [matchedGoal({ id: 'retracted' }), retained]
    const es = await start()
    history = [retained]
    es.emit('error')

    await vi.waitFor(() => expect(headings()).toEqual(['Friday 25 September 2026']), { timeout: 3000 })
    expect(rows()).toHaveLength(1)
  })

  test('holds new day headings and retractions while paused, then updates on resume', async () => {
    history = [matchedGoal()]
    const es = await start()
    document.getElementById('toggle-pause').click()
    es.emit('goal', matchedGoal({ id: 'new', utcTimestamp: '2026-09-27T14:00:00.000Z' }))
    es.emit('goal-retracted', { id: '1-100' })
    expect(headings()).toEqual(['Saturday 26 September 2026'])

    document.getElementById('toggle-pause').click()
    expect(headings()).toEqual(['Sunday 27 September 2026'])
    expect(rows()).toHaveLength(1)
  })

  test('defers history reconciliation while paused on reconnect', async () => {
    history = [matchedGoal()]
    const es = await start()
    document.getElementById('toggle-pause').click()
    history = [matchedGoal({ id: 'new', utcTimestamp: '2026-09-27T14:00:00.000Z' })]
    es.emit('error')
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(headings()).toEqual(['Saturday 26 September 2026'])

    document.getElementById('toggle-pause').click()
    expect(headings()).toEqual(['Sunday 27 September 2026', 'Saturday 26 September 2026'])
  })
})

describe('videprinter scorer name formatting', () => {
  test.each([
    ['ashley fletcher', 'Fletcher, A'],
    ['FLETCHER, Ashley', 'Fletcher, A'],
    ['fLeTcHeR, aShLeY', 'Fletcher, A'],
    ['a. fletcher', 'Fletcher, A'],
    ['a fletcher', 'Fletcher, A'],
    ['Fletcher A.', 'Fletcher, A'],
    ['Fletcher a', 'Fletcher, A'],
    ['Fletcher, a.', 'Fletcher, A'],
    ['fletcher', 'Fletcher'],
    ['fletcher,', 'Fletcher'],
    ['  FLETCHER,  ashley  ', 'Fletcher, A'],
    ['  ashley\t\n fletcher  ', 'Fletcher, A'],
    ['Paudie O’Connor', 'O’Connor, P'],
    ["paudie o'connor", "O'Connor, P"],
    ['emile smith-rowe', 'Smith-Rowe, E'],
    ['Ludwig van Beethoven', 'Van Beethoven, L'],
    ['D. van Wageningen', 'Van Wageningen, D'],
    ['van Beethoven, Ludwig', 'Van Beethoven, L'],
    ['van Beethoven l.', 'Van Beethoven, L'],
    ['édouard núñez', 'Núñez, É'],
    ['NÚÑEZ, édouard', 'Núñez, É'],
    ['ashley fletcher OG', 'Fletcher, A OG'],
    ['FLETCHER, a. og', 'Fletcher, A OG'],
    ['fletcher OG', 'Fletcher OG'],
    ['  ', 'Unknown'],
    ['', 'Unknown'],
    [null, 'Unknown'],
    [undefined, 'Unknown'],
    ['Unknown', 'Unknown']
  ])('displays %j as %j in live goals', async (name, expected) => {
    const es = await start()
    es.emit('goal', goal({ scorer: { name } }))

    expect(rows()[0].querySelector('.goal-scorer').textContent).toBe(expected)
  })

  test('formats saved history when it loads', async () => {
    history = [
      goal({ id: '1-100', scorer: { name: 'FLETCHER, Ashley' } }),
      goal({ id: '1-101', scorer: { name: 'Paudie O’Connor OG' } }),
      goal({ id: '1-102', scorer: { name: 'fletcher' } })
    ]

    await start()

    expect(rows().map(row => row.querySelector('.goal-scorer').textContent)).toEqual([
      'Fletcher, A', 'O’Connor, P OG', 'Fletcher'
    ])
    expect(history[0].scorer.name).toBe('FLETCHER, Ashley')
  })

  test('uses Unknown when a goal has no scorer', async () => {
    const es = await start()
    es.emit('goal', goal({ scorer: null }))

    expect(rows()[0].querySelector('.goal-scorer').textContent).toBe('Unknown')
  })
})

describe('videprinter client corrections and retractions', () => {
  test('replaces a goal in place when the provider corrects it', async () => {
    const es = await start()
    es.emit('goal', goal({ potentialGoalFor: { manager: 'John', substitute: false } }))
    es.emit('goal', goal({ scorer: { name: 'Dan James' }, potentialGoalFor: { manager: 'John', substitute: false } }))

    expect(rows()).toHaveLength(1)
    expect(rows()[0].querySelector('.goal-scorer').textContent).toBe('James, D')
  })

  test('ignores a re-send of a goal it is already showing', async () => {
    const es = await start()
    const unchanged = goal({ potentialGoalFor: { manager: 'John', substitute: false } })
    es.emit('goal', unchanged)
    const first = rows()[0]
    es.emit('goal', unchanged)

    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toBe(first)
  })

  test('removes a goal the provider retracts', async () => {
    const es = await start()
    es.emit('goal', goal({ potentialGoalFor: { manager: 'John', substitute: false } }))
    es.emit('goal-retracted', { id: '1-100', fixtureId: '1' })

    expect(rows()).toHaveLength(0)
    expect(document.getElementById('empty-state').style.display).toBe('block')
  })

  test('drops a goal retracted while the stream was down, on reconnect', async () => {
    const es = await start()
    es.emit('goal', goal({ id: '1-100', potentialGoalFor: { manager: 'John', substitute: false } }))
    es.emit('goal', goal({ id: '1-101', minute: 30, potentialGoalFor: { manager: 'John', substitute: false } }))
    expect(rows()).toHaveLength(2)

    history = [goal({ id: '1-101', minute: 30, potentialGoalFor: { manager: 'John', substitute: false } })]
    es.emit('error')
    // The client reconnects after its backoff delay, and resyncs history when it does.
    await vi.waitFor(() => expect(rows()).toHaveLength(1), { timeout: 3000 })
  })
})

describe('videprinter client filtering and pausing', () => {
  test('reports how many goals the filter is hiding', async () => {
    const es = await start()
    es.emit('goal', goal({ id: '1-100' }))
    es.emit('goal', goal({ id: '1-101', minute: 30 }))

    expect(visibleRows()).toHaveLength(0)
    expect(document.getElementById('filter-notice').textContent).toBe('2 goals hidden by filter')

    const toggle = document.getElementById('toggle-all-goals')
    toggle.checked = true
    toggle.dispatchEvent(new Event('change'))

    expect(visibleRows()).toHaveLength(2)
    expect(document.getElementById('filter-notice').textContent).toBe('')
  })

  test('holds goals that arrive while paused and shows them on resume', async () => {
    const es = await start()
    document.getElementById('toggle-pause').click()

    es.emit('goal', goal({ potentialGoalFor: { manager: 'John', substitute: false } }))
    expect(rows()).toHaveLength(0)

    document.getElementById('toggle-pause').click()
    expect(rows()).toHaveLength(1)
  })
})
