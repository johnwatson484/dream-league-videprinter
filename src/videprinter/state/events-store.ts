import type { GoalEvent, ListOptions } from '../types.ts'

const DEFAULT_LIST_OPTIONS: ListOptions = { limit: 100, order: 'desc' }

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

  list (options: ListOptions = DEFAULT_LIST_OPTIONS): GoalEvent[] {
    const { limit = 100, order = 'desc' } = options
    const slice = this.events.slice(-limit)
    if (order === 'desc') { return slice.slice().reverse() }
    return slice
  }
}

export const eventsStore = new EventsStore()
