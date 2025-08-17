// In-memory ring buffer of recent goal events for replay on new connections / refresh.

class EventsStore {
  constructor (limit = 500) {
    this.limit = limit
    this.events = [] // oldest -> newest
  }

  add (event) {
    this.events.push(event)
    if (this.events.length > this.limit) {
      this.events.shift()
    }
  }

  list (options = {}) {
    const { limit = 100, order = 'desc' } = options
    const slice = this.events.slice(-limit)
    if (order === 'desc') return slice.slice().reverse()
    return slice
  }
}

export const eventsStore = new EventsStore()
