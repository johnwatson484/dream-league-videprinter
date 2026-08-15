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
    const active = this.events.filter(event => !event.retracted)
    const slice = active.slice(-limit)
    if (order === 'desc') { return slice.slice().reverse() }
    return slice
  }

  all (): GoalEvent[] {
    return this.events.filter(event => !event.retracted)
  }

  update (event: GoalEvent): void {
    const index = this.events.findIndex(existing => existing.id === event.id)
    if (index !== -1) {
      this.events[index] = event
    }
  }

  // Mongo-disabled equivalent of storage/mongo.ts retractEvents: soft-delete, kept for audit.
  retract (id: string): void {
    const index = this.events.findIndex(existing => existing.id === id)
    if (index !== -1) {
      this.events[index] = { ...this.events[index]!, retracted: true, retractedAt: new Date() }
    }
  }

  clear (): void {
    this.events = []
  }
}

export const eventsStore = new EventsStore()
