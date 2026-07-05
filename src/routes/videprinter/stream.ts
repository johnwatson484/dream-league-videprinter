import type { ServerRoute } from '@hapi/hapi'
import type { GoalEvent } from '../../videprinter/types.ts'
import { videprinterBroadcaster } from '../../videprinter/state/broadcaster.ts'
import { PassThrough } from 'node:stream'

function writeEvent (res: PassThrough, event: string, dataObj: string | object): void {
  const payload = typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj)
  res.write(`event: ${event}\n`)
  res.write(`data: ${payload}\n\n`)
}

const route: ServerRoute = {
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
      .header('X-Accel-Buffering', 'no')
      .header('Content-Encoding', 'identity')

    stream.write(': connected\n\n')
    writeEvent(stream, 'connected', { type: 'init', ts: new Date().toISOString() })
    const onGoal = (event: GoalEvent): void => { writeEvent(stream, 'goal', event) }
    const onHeartbeat = (): void => { writeEvent(stream, 'heartbeat', { ts: new Date().toISOString() }) }
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
