export interface PendingFixtureEntry<T> {
  fixtureId: string
  data: T
  firstSeenAt: number
}

// Generic over the caller's own snapshot type so this module stays provider-agnostic;
// live-score.ts stores its raw match object here to re-fetch events for it directly,
// independent of the next full live-matches poll.
export class PendingFixtureTracker<T> {
  private readonly entries = new Map<string, { data: T; firstSeenAt: number }>()

  // Refreshes the snapshot on every call but keeps the original firstSeenAt, so grace
  // period expiry measures how long the fixture has been unresolved, not how fresh the data is.
  mark (fixtureId: string, data: T, now = Date.now()): void {
    const existing = this.entries.get(fixtureId)
    this.entries.set(fixtureId, { data, firstSeenAt: existing?.firstSeenAt ?? now })
  }

  forget (fixtureId: string): void { this.entries.delete(fixtureId) }

  all (): Array<PendingFixtureEntry<T>> {
    return [...this.entries].map(([fixtureId, entry]) => ({ fixtureId, ...entry }))
  }

  // Removes and returns entries that have been unresolved for longer than maxAgeMs, so the
  // caller can log a real loss before the fixture is dropped for good.
  expire (maxAgeMs: number, now = Date.now()): Array<PendingFixtureEntry<T>> {
    const expired: Array<PendingFixtureEntry<T>> = []
    for (const [fixtureId, entry] of this.entries) {
      if (now - entry.firstSeenAt > maxAgeMs) {
        expired.push({ fixtureId, ...entry })
        this.entries.delete(fixtureId)
      }
    }
    return expired
  }

  clear (): void { this.entries.clear() }
}
