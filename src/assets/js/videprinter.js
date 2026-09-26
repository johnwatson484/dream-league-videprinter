/* eslint-env browser */
/* global EventSource */
(function () {
  const list = document.getElementById('videprinter')
  const statusEl = document.getElementById('status')
  const pauseBtn = document.getElementById('toggle-pause')
  const emptyState = document.getElementById('empty-state')
  const toggleAllGoals = document.getElementById('toggle-all-goals')
  const filterNotice = document.getElementById('filter-notice')

  let paused = false
  let showAllGoals = toggleAllGoals.checked
  let es
  let retryDelay = 1000
  let lastHeartbeatTs = null

  // Rendered goals by id. Holds the content signature so a correction to a goal already on
  // screen can replace its row, rather than be dismissed as one we have seen.
  const rendered = new Map()
  // Updates that arrived while paused, replayed in order on resume so none are lost.
  const deferred = []

  function element (tag, className, text) {
    const node = document.createElement(tag)
    if (className) { node.className = className }
    if (text != null) { node.textContent = text }
    return node
  }

  // The feed says which way round the fixture reads. Goals stored before that was captured
  // have to infer it from the score, which only works while the two scores differ.
  function orderTeams (goal) {
    const scoring = goal.scoringTeam.name
    const conceding = goal.concedingTeam.name
    if (goal.homeTeam && goal.awayTeam) { return [goal.homeTeam, goal.awayTeam] }

    const score = goal.scoreAfterEvent
    if (score && score.home != null && score.away != null && score.home !== score.away) {
      return score.home > score.away ? [scoring, conceding] : [conceding, scoring]
    }
    return [scoring, conceding].sort()
  }

  function dreamLeagueLine (modifier, label, match) {
    const line = element('div', `dream-league-info ${modifier}`)
    line.append(label, element('strong', null, match.manager))
    if (match.substitute) { line.append(' (SUB)') }
    return line
  }

  // Built with textContent throughout: every value here comes from the provider, so none of
  // it may be parsed as markup.
  function buildEvent (goal) {
    const li = element('li', 'videprinter-event list-group-item')
    li.dataset.timestamp = goal.utcTimestamp || ''

    const header = element('div', 'goal-header')
    if (goal.minute != null) { header.append(element('span', 'goal-minute', `${goal.minute}'`)) }

    const [homeTeam, awayTeam] = orderTeams(goal)
    const scoring = goal.scoringTeam.name
    header.append(
      element('span', homeTeam === scoring ? 'scoring-team' : 'conceding-team', homeTeam),
      ' ',
      element('span', 'vs-text', 'vs'),
      ' ',
      element('span', awayTeam === scoring ? 'scoring-team' : 'conceding-team', awayTeam)
    )

    const score = goal.scoreAfterEvent
    if (score && score.home != null && score.away != null) {
      header.append(' ', element('span', 'current-score', `${score.home}-${score.away}`))
    }

    const details = element('div', 'goal-details')
    details.append(element('span', 'goal-scorer', goal.scorer.name))
    if (goal.potentialGoalFor) {
      details.append(dreamLeagueLine('potential-goal', 'Goal for ', goal.potentialGoalFor))
    }
    if (goal.potentialConcedingFor) {
      details.append(dreamLeagueLine('potential-concede', 'Goal conceded by ', goal.potentialConcedingFor))
    }

    li.append(header, details)
    return li
  }

  // Everything the row displays, so a re-send is ignored but a genuine revision is not.
  function signatureOf (goal) {
    return JSON.stringify([
      goal.minute, goal.scorer.name, goal.scoringTeam.name, goal.concedingTeam.name,
      goal.homeTeam || null, goal.awayTeam || null,
      goal.scoreAfterEvent?.home ?? null, goal.scoreAfterEvent?.away ?? null,
      goal.potentialGoalFor?.manager || null, goal.potentialGoalFor?.substitute || false,
      goal.potentialConcedingFor?.manager || null, goal.potentialConcedingFor?.substitute || false
    ])
  }

  function isMatched (goal) {
    return Boolean(goal.potentialGoalFor || goal.potentialConcedingFor)
  }

  // Newest first. Goals can arrive out of order - a late one from an earlier minute, or a
  // history resync - so position by timestamp rather than always going to the top.
  function insertInOrder (li) {
    const timestamp = li.dataset.timestamp
    for (const child of list.children) {
      if (child.dataset.timestamp < timestamp) {
        list.insertBefore(li, child)
        return
      }
    }
    list.append(li)
  }

  function flash (li, className) {
    li.classList.add(className)
    setTimeout(() => { li.classList.remove(className) }, 1000)
  }

  function upsertEvent (goal, { animate = true } = {}) {
    if (!goal || !goal.id) { return }

    const signature = signatureOf(goal)
    const existing = rendered.get(goal.id)
    if (existing && existing.signature === signature) { return }

    const matched = isMatched(goal)
    const li = buildEvent(goal)
    li.classList.toggle('filtered-out', !showAllGoals && !matched)

    if (existing) {
      list.replaceChild(li, existing.element)
      flash(li, 'corrected-goal')
    } else {
      insertInOrder(li)
      if (animate) { flash(li, 'new-goal') }
    }

    rendered.set(goal.id, { signature, matched, element: li })
    refreshFilterState()
  }

  function retractEvent (id) {
    const existing = rendered.get(id)
    if (!existing) { return }

    existing.element.remove()
    rendered.delete(id)
    refreshFilterState()
  }

  function applyFilter () {
    for (const entry of rendered.values()) {
      entry.element.classList.toggle('filtered-out', !showAllGoals && !entry.matched)
    }
    refreshFilterState()
  }

  function refreshFilterState () {
    let hidden = 0
    for (const entry of rendered.values()) {
      if (!showAllGoals && !entry.matched) { hidden += 1 }
    }

    emptyState.style.display = rendered.size - hidden > 0 ? 'none' : 'block'
    filterNotice.textContent = hidden > 0
      ? `${hidden} goal${hidden === 1 ? '' : 's'} hidden by filter`
      : ''
  }

  function timeAgo (ts) {
    const d = Date.now() - ts
    if (d < 2000) { return '1s' }
    if (d < 60000) { return Math.floor(d / 1000) + 's' }
    return Math.floor(d / 60000) + 'm'
  }

  function updateStatus (text) {
    statusEl.textContent = text + (lastHeartbeatTs ? ` (last hb ${timeAgo(lastHeartbeatTs)})` : '')

    statusEl.classList.remove('bg-success', 'bg-warning', 'bg-danger', 'bg-secondary', 'live', 'connecting', 'reconnecting')
    if (text === 'Live') {
      statusEl.classList.add('bg-success', 'live')
    } else if (text === 'Connecting...') {
      statusEl.classList.add('bg-warning', 'connecting')
    } else if (text === 'Reconnecting...') {
      statusEl.classList.add('bg-danger', 'reconnecting')
    } else {
      statusEl.classList.add('bg-secondary')
    }
  }

  // History returns only goals that still stand, newest first, so anything on screen from
  // within the window it covers but absent from it was retracted while we were away.
  // Goals older than the window are left alone.
  function reconcile (events) {
    if (events.length === 0) { return }

    const oldest = events[events.length - 1].utcTimestamp || ''
    const active = new Set(events.map(ev => ev.id))
    for (const [id, entry] of rendered) {
      if (!active.has(id) && entry.element.dataset.timestamp >= oldest) {
        entry.element.remove()
        rendered.delete(id)
      }
    }
  }

  // Also run on reconnect, where it doubles as catch-up: upsert applies whatever was missed
  // or corrected while the stream was down, and reconcile drops whatever was retracted.
  function loadHistory () {
    return fetch('/videprinter/history?limit=200')
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data.events)) { return }
        reconcile(data.events)
        data.events.forEach(ev => { upsertEvent(ev, { animate: false }) })
      })
      .catch(err => { console.error('failed to load videprinter history', err) })
  }

  function applyOrDefer (update) {
    if (paused) {
      deferred.push(update)
      return
    }
    update()
  }

  pauseBtn.addEventListener('click', () => {
    paused = !paused
    if (paused) {
      pauseBtn.innerHTML = '<i class="bi bi-play-fill"></i> Resume'
      pauseBtn.classList.remove('btn-outline-secondary')
      pauseBtn.classList.add('btn-secondary')
    } else {
      pauseBtn.innerHTML = '<i class="bi bi-pause-fill"></i> Pause'
      pauseBtn.classList.remove('btn-secondary')
      pauseBtn.classList.add('btn-outline-secondary')
      deferred.splice(0).forEach(update => { update() })
    }
  })

  toggleAllGoals.addEventListener('change', () => {
    showAllGoals = toggleAllGoals.checked
    applyFilter()
  })

  setInterval(() => {
    if (statusEl.textContent.startsWith('Live') && lastHeartbeatTs) {
      updateStatus('Live')
    }
  }, 5000)

  function connect () {
    updateStatus('Connecting...')
    loadHistory()

    es = new EventSource('/videprinter/stream')

    es.addEventListener('open', () => {
      retryDelay = 1000
      updateStatus('Live')
    })

    es.addEventListener('error', () => {
      updateStatus('Reconnecting...')
      // EventSource retries on its own but without backoff, so drive reconnection manually.
      try { es.close() } catch {}
      setTimeout(connect, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 15000)
    })

    es.addEventListener('goal', (e) => {
      let goal
      try {
        goal = JSON.parse(e.data)
      } catch (err) {
        console.error('bad goal event', err)
        return
      }
      applyOrDefer(() => { upsertEvent(goal) })
    })

    es.addEventListener('goal-retracted', (e) => {
      let payload
      try {
        payload = JSON.parse(e.data)
      } catch (err) {
        console.error('bad goal-retracted event', err)
        return
      }
      applyOrDefer(() => { retractEvent(payload.id) })
    })

    es.addEventListener('heartbeat', () => {
      lastHeartbeatTs = Date.now()
      if (!paused) { updateStatus('Live') }
    })
  }

  refreshFilterState()
  connect()
})()
