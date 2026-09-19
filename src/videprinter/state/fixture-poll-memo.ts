interface FixturePoll {
  scoreTotal: number
  status: string
  at: number
}

const STALE_MS = 24 * 60 * 60 * 1000

// Remembers what the last trusted events fetch saw for a fixture, so a fixture whose score
// and status have not moved does not have its events re-fetched on every single cycle.
class FixturePollMemo {
  polls: Map<string, FixturePoll>

  constructor () {
    this.polls = new Map()
  }

  get (fixtureId: string): FixturePoll | undefined { return this.polls.get(fixtureId) }

  record (fixtureId: string, scoreTotal: number, status: string, now = Date.now()): void {
    this.polls.set(fixtureId, { scoreTotal, status, at: now })
    this.prune(now)
  }

  forget (fixtureId: string): void { this.polls.delete(fixtureId) }

  // Fixtures drop out of the live feed for good, so entries would otherwise accumulate
  // for the lifetime of the process.
  prune (now = Date.now()): void {
    for (const [fixtureId, poll] of this.polls) {
      if (now - poll.at > STALE_MS) { this.polls.delete(fixtureId) }
    }
  }

  clear (): void { this.polls.clear() }
}

export const fixturePollMemo = new FixturePollMemo()
