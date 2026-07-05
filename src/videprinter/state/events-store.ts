import type { GoalEvent, ListOptions } from '../types.ts'

class EventsStore {
  limit: number
  events: GoalEvent[]

  constructor (limit = 500) {
    this.limit = limit
    this.events = []
  }

  add (event: GoalEvent): void {
    this.events.push(event)
    if (this.events.length > this.limit) {
      this.events.shift()
    }
  }

  list (options: ListOptions = { limit: 100, order: 'desc' }): GoalEvent[] {
    const { limit = 100, order = 'desc' } = options
    const slice = this.events.slice(-limit)
    if (order === 'desc') { return slice.slice().reverse() }
    return slice
  }
}

export const eventsStore = new EventsStore()
