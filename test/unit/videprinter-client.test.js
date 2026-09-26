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

const rows = () => Array.from(document.querySelectorAll('#videprinter li'))
const visibleRows = () => rows().filter(li => !li.classList.contains('filtered-out'))
const text = li => li.textContent.replace(/\s+/g, ' ').trim()

beforeEach(() => {
  history = []
  vi.useRealTimers()
})

describe('videprinter client rendering', () => {
  test('renders a goal pushed over the stream', async () => {
    const es = await start()
    es.emit('goal', goal({ potentialGoalFor: { manager: 'John', substitute: false } }))

    expect(rows()).toHaveLength(1)
    expect(text(rows()[0])).toBe("23'Derby vs Leeds 0-1Joel PiroeGoal for John")
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
      scorer: { name: '<img src=x onerror="alert(1)">' },
      potentialGoalFor: { manager: '<script>alert(2)</script>', substitute: false }
    }))

    expect(document.querySelectorAll('#videprinter img')).toHaveLength(0)
    expect(document.querySelectorAll('#videprinter script')).toHaveLength(0)
    expect(rows()[0].querySelector('.goal-scorer').textContent).toBe('<img src=x onerror="alert(1)">')
  })
})

describe('videprinter client corrections and retractions', () => {
  test('replaces a goal in place when the provider corrects it', async () => {
    const es = await start()
    es.emit('goal', goal({ potentialGoalFor: { manager: 'John', substitute: false } }))
    es.emit('goal', goal({ scorer: { name: 'Dan James' }, potentialGoalFor: { manager: 'John', substitute: false } }))

    expect(rows()).toHaveLength(1)
    expect(rows()[0].querySelector('.goal-scorer').textContent).toBe('Dan James')
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
