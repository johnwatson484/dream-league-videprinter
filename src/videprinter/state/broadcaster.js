import EventEmitter from 'events'

class VideprinterBroadcaster extends EventEmitter {}

export const videprinterBroadcaster = new VideprinterBroadcaster()

// heartbeats
setInterval(() => {
  videprinterBroadcaster.emit('heartbeat')
}, 20000)
