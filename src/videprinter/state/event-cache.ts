class EventCache {
  max: number
  ids: Set<string>
  queue: string[]

  constructor (max = 1000) {
    this.max = max
    this.ids = new Set()
    this.queue = []
  }

  has (id: string): boolean { return this.ids.has(id) }

  add (id: string): void {
    if (this.ids.has(id)) { return }
    this.ids.add(id)
    this.queue.push(id)
    if (this.queue.length > this.max) {
      const oldest = this.queue.shift()
      if (oldest) { this.ids.delete(oldest) }
    }
  }
}

export const eventCache = new EventCache()
