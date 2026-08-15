// Tracks the last-broadcast content signature per goal id (bounded, oldest evicted first).
// Mongo/eventsStore dedupe on read, but both are optional/in-memory-bounded, so this guards
// broadcasts in-process too: it is what lets the poller tell new / corrected / unchanged apart.
class EventCache {
  max: number
  signatures: Map<string, string>

  constructor (max = 1000) {
    this.max = max
    this.signatures = new Map()
  }

  has (id: string): boolean { return this.signatures.has(id) }

  get (id: string): string | undefined { return this.signatures.get(id) }

  set (id: string, signature: string): void {
    this.signatures.delete(id)
    this.signatures.set(id, signature)
    if (this.signatures.size > this.max) {
      const oldest = this.signatures.keys().next().value
      if (oldest !== undefined) { this.signatures.delete(oldest) }
    }
  }

  delete (id: string): void { this.signatures.delete(id) }

  clear (): void { this.signatures.clear() }
}

export const eventCache = new EventCache()
