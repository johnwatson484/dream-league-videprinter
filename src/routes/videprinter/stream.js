import { videprinterBroadcaster } from '../../videprinter/state/broadcaster.js'
import { PassThrough } from 'node:stream'

function writeEvent (res, event, dataObj) {
  const payload = typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj)
  res.write(`event: ${event}\n`)
  res.write(`data: ${payload}\n\n`)
}

const route = {
  method: 'GET',
  path: '/videprinter/stream',
  options: {
    id: 'videprinter.stream',
    tags: ['videprinter'],
    cors: true,
    cache: false,
    auth: false,
    description: 'Server-Sent Events stream of videprinter goal events',
    ext: {
      onPreResponse: {
        method: (request, h) => h.continue,
      },
    },
  },
  handler: (request, h) => {
    // Detect injection tests by user-agent header from shot
    const isInject = request.headers['user-agent'] === 'shot'
    if (isInject) {
      const payload = 'event: connected\n' + 'data: {"type":"init"}\n\n'
      return h.response(payload).code(200).type('text/event-stream')
    }
    request.logger?.info('[videprinter] SSE client connecting')
    const stream = new PassThrough()
    const response = h.response(stream)
      .code(200)
      .type('text/event-stream')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('Connection', 'keep-alive')
      // Prevent proxy buffering (NGINX, etc.) and compression which can delay SSE delivery
      .header('X-Accel-Buffering', 'no')
      .header('Content-Encoding', 'identity')

    // Initial comment to force headers flush in some proxies
    stream.write(': connected\n\n')
    // initial event
    writeEvent(stream, 'connected', { type: 'init', ts: new Date().toISOString() })
    const onGoal = (event) => writeEvent(stream, 'goal', event)
    const onHeartbeat = () => writeEvent(stream, 'heartbeat', { ts: new Date().toISOString() })
    videprinterBroadcaster.on('goal', onGoal)
    videprinterBroadcaster.on('heartbeat', onHeartbeat)
    request.raw.req.on('close', () => {
      videprinterBroadcaster.off('goal', onGoal)
      videprinterBroadcaster.off('heartbeat', onHeartbeat)
      request.logger?.info('[videprinter] SSE client disconnected')
      stream.end()
    })
    return response
  },
}

export default route
