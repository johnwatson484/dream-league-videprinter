/* eslint-env browser */
/* global EventSource */
(function () {
  const list = document.getElementById('videprinter')
  const statusEl = document.getElementById('status')
  const pauseBtn = document.getElementById('toggle-pause')
  let paused = false
  let es
  let retryDelay = 1000
  let lastHeartbeatTs = null

  pauseBtn.addEventListener('click', () => {
    paused = !paused
    pauseBtn.textContent = paused ? 'Resume' : 'Pause'
  })

  function updateStatus (text) {
    statusEl.textContent = text + (lastHeartbeatTs ? ` (last hb ${timeAgo(lastHeartbeatTs)})` : '')
  }

  function timeAgo (ts) {
    const d = Date.now() - ts
    if (d < 2000) return '1s'
    if (d < 60000) return Math.floor(d / 1000) + 's'
    return Math.floor(d / 60000) + 'm'
  }

  setInterval(() => {
    if (statusEl.textContent.startsWith('Live') && lastHeartbeatTs) {
      updateStatus('Live')
    }
  }, 5000)

  function prependEvent (goal) {
    if (paused) return
    const li = document.createElement('li')
    li.className = 'videprinter-event'
    const minute = goal.minute != null ? `[${goal.minute}' ] ` : ''
    li.textContent = `${minute}${goal.scoringTeam.name} vs ${goal.concedingTeam.name} – GOAL ${goal.scorer.name}`
    list.prepend(li)
  }

  function connect () {
    updateStatus('Connecting...')
    // Load recent history only on first connect
    if (!es) {
      fetch('/videprinter/history?limit=50')
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data.events)) {
            [...data.events].reverse().forEach(ev => prependEvent(ev))
          }
        }).catch(() => {})
    }
    es = new EventSource('/videprinter/stream')
    es.addEventListener('open', () => {
      retryDelay = 1000
      updateStatus('Live')
    })
    es.addEventListener('error', () => {
      updateStatus('Reconnecting...')
      // Exponential backoff managed manually by closing and recreating
      try { es.close() } catch {}
      setTimeout(connect, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 15000)
    })
    es.addEventListener('goal', (e) => {
      try { prependEvent(JSON.parse(e.data)) } catch (err) { console.error('bad goal event', err) }
    })
    es.addEventListener('heartbeat', () => {
      lastHeartbeatTs = Date.now()
      if (!paused) updateStatus('Live')
    })
  }

  connect()
})()
