// Simple in-memory cache of last seen goal ids to prevent duplicates

class EventCache {
  constructor (max = 1000) {
    this.max = max
    this.ids = new Set()
    this.queue = []
  }

  has (id) { return this.ids.has(id) }

  add (id) {
    if (this.ids.has(id)) return
    this.ids.add(id)
    this.queue.push(id)
    if (this.queue.length > this.max) {
      const oldest = this.queue.shift()
      this.ids.delete(oldest)
    }
  }
}

export const eventCache = new EventCache()
