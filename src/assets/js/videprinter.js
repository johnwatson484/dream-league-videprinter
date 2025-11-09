/* eslint-env browser */
/* global EventSource */
(function () {
  const list = document.getElementById('videprinter')
  const statusEl = document.getElementById('status')
  const pauseBtn = document.getElementById('toggle-pause')
  const emptyState = document.getElementById('empty-state')
  let paused = false
  let es
  let retryDelay = 1000
  let lastHeartbeatTs = null
  let lastEventTimestamp = null
  const knownEventIds = new Set()

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
    }
  })

  function updateStatus (text) {
    const fullText = text + (lastHeartbeatTs ? ` (last hb ${timeAgo(lastHeartbeatTs)})` : '')
    statusEl.textContent = fullText

    // Update status styling
    statusEl.classList.remove('bg-success', 'bg-warning', 'bg-danger', 'live', 'connecting', 'reconnecting')
    if (text === 'Live') {
      statusEl.classList.add('bg-success', 'live')
    } else if (text === 'Connecting...') {
      statusEl.classList.add('bg-warning', 'connecting')
    } else if (text === 'Reconnecting...') {
      statusEl.classList.add('bg-danger', 'reconnecting')
    } else {
      statusEl.classList.add('bg-secondary')
    }
  } function timeAgo (ts) {
    const d = Date.now() - ts
    if (d < 2000) return '1s'
    if (d < 60000) return Math.floor(d / 1000) + 's'
    return Math.floor(d / 60000) + 'm'
  }

  function toggleEmptyState () {
    const hasEvents = list.children.length > 0
    emptyState.style.display = hasEvents ? 'none' : 'block'
  }

  setInterval(() => {
    if (statusEl.textContent.startsWith('Live') && lastHeartbeatTs) {
      updateStatus('Live')
    }
  }, 5000)

  function prependEvent (goal) {
    if (paused) return

    // Skip if we've already seen this event
    if (knownEventIds.has(goal.id)) return

    // Track this event
    knownEventIds.add(goal.id)
    if (goal.utcTimestamp) {
      lastEventTimestamp = goal.utcTimestamp
    }

    const li = document.createElement('li')
    li.className = 'videprinter-event list-group-item new-goal'

    const minute = goal.minute != null ? `<span class="goal-minute">${goal.minute}'</span>` : ''

    // Determine team display order - home team first, with scoring team bold
    let teamDisplay
    if (goal.scoreAfterEvent && goal.scoreAfterEvent.home != null && goal.scoreAfterEvent.away != null) {
      // Use scoreAfterEvent to determine which team is home and which is away
      const homeScore = goal.scoreAfterEvent.home
      const awayScore = goal.scoreAfterEvent.away

      // Determine which team is home/away by comparing current scores with previous
      // If scoring team's current score is higher, they just scored
      let homeTeam, awayTeam

      // Check if scoring team corresponds to home or away position
      if (homeScore > awayScore) {
        // Home team just scored (their score is higher)
        homeTeam = goal.scoringTeam.name
        awayTeam = goal.concedingTeam.name
      } else if (awayScore > homeScore) {
        // Away team just scored (their score is higher)
        homeTeam = goal.concedingTeam.name
        awayTeam = goal.scoringTeam.name
      } else {
        // Scores are equal, use alphabetical as fallback
        const teams = [goal.scoringTeam.name, goal.concedingTeam.name].sort()
        homeTeam = teams[0]
        awayTeam = teams[1]
      }

      // Apply CSS classes based on which team scored (regardless of home/away position)
      const homeClass = homeTeam === goal.scoringTeam.name ? 'scoring-team' : 'conceding-team'
      const awayClass = awayTeam === goal.scoringTeam.name ? 'scoring-team' : 'conceding-team'

      teamDisplay = `<span class="${homeClass}">${homeTeam}</span> <span class="vs-text">vs</span> <span class="${awayClass}">${awayTeam}</span>`
    } else {
      // Fallback: use alphabetical ordering as home/away, bold the scoring team
      const teams = [goal.scoringTeam.name, goal.concedingTeam.name].sort()
      const homeTeam = teams[0]
      const awayTeam = teams[1]

      const homeClass = homeTeam === goal.scoringTeam.name ? 'scoring-team' : 'conceding-team'
      const awayClass = awayTeam === goal.scoringTeam.name ? 'scoring-team' : 'conceding-team'

      teamDisplay = `<span class="${homeClass}">${homeTeam}</span> <span class="vs-text">vs</span> <span class="${awayClass}">${awayTeam}</span>`
    }

    // Add current score if available
    let currentScore = ''
    if (goal.scoreAfterEvent && goal.scoreAfterEvent.home != null && goal.scoreAfterEvent.away != null) {
      currentScore = ` <span class="current-score">${goal.scoreAfterEvent.home}-${goal.scoreAfterEvent.away}</span>`
    }

    const scorer = `<span class="goal-scorer">${goal.scorer.name}</span>`

    // Add Dream League Fantasy Football information
    let dreamLeagueInfo = ''
    if (goal.potentialGoalFor) {
      const substitute = goal.potentialGoalFor.substitute ? ' (SUB)' : ''
      dreamLeagueInfo += `<div class="dream-league-info potential-goal">Potential goal for <strong>${goal.potentialGoalFor.manager}</strong>${substitute}</div>`
    }
    if (goal.potentialConcedingFor) {
      const substitute = goal.potentialConcedingFor.substitute ? ' (SUB)' : ''
      dreamLeagueInfo += `<div class="dream-league-info potential-concede">Potential concede for <strong>${goal.potentialConcedingFor.manager}</strong>${substitute}</div>`
    }

    li.innerHTML = `
      <div class="goal-header">
        ${minute}${teamDisplay}${currentScore}
      </div>
      <div class="goal-details">
        ${scorer}${dreamLeagueInfo}
      </div>
    `

    list.prepend(li)
    toggleEmptyState()

    // Remove animation class after animation completes
    setTimeout(() => {
      li.classList.remove('new-goal')
    }, 1000)
  }

  function fetchMissedEvents () {
    if (!lastEventTimestamp) return Promise.resolve()

    return fetch('/videprinter/history?limit=200')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.events)) {
          // Filter events newer than our last known event
          const missedEvents = data.events.filter(ev =>
            ev.utcTimestamp && ev.utcTimestamp > lastEventTimestamp && !knownEventIds.has(ev.id)
          )

          // Add missed events (newest first)
          missedEvents.forEach(ev => {
            prependEvent(ev)
          })

          if (missedEvents.length > 0) {
            console.log(`Recovered ${missedEvents.length} missed events after reconnection`)
          }
        }
      })
      .catch(err => {
        console.error('Failed to fetch missed events:', err)
      })
  }

  function connect () {
    updateStatus('Connecting...')

    if (!es) {
      // Load recent history only on first connect
      fetch('/videprinter/history?limit=200')
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data.events)) {
            [...data.events].reverse().forEach(ev => {
              // Track historical events to prevent duplicates
              knownEventIds.add(ev.id)
              if (ev.utcTimestamp && (!lastEventTimestamp || ev.utcTimestamp > lastEventTimestamp)) {
                lastEventTimestamp = ev.utcTimestamp
              }

              const li = document.createElement('li')
              li.className = 'videprinter-event list-group-item'

              const minute = ev.minute != null ? `<span class="goal-minute">${ev.minute}'</span>` : ''

              // Determine team display order for history - home team first, with scoring team bold
              let teamDisplay
              if (ev.scoreAfterEvent && ev.scoreAfterEvent.home != null && ev.scoreAfterEvent.away != null) {
                // Use scoreAfterEvent to determine which team is home and which is away
                const homeScore = ev.scoreAfterEvent.home
                const awayScore = ev.scoreAfterEvent.away

                // Determine which team is home/away by comparing current scores with previous
                let homeTeam, awayTeam

                // Check if scoring team corresponds to home or away position
                if (homeScore > awayScore) {
                  // Home team just scored (their score is higher)
                  homeTeam = ev.scoringTeam.name
                  awayTeam = ev.concedingTeam.name
                } else if (awayScore > homeScore) {
                  // Away team just scored (their score is higher)
                  homeTeam = ev.concedingTeam.name
                  awayTeam = ev.scoringTeam.name
                } else {
                  // Scores are equal, use alphabetical as fallback
                  const teams = [ev.scoringTeam.name, ev.concedingTeam.name].sort()
                  homeTeam = teams[0]
                  awayTeam = teams[1]
                }

                // Apply CSS classes based on which team scored (regardless of home/away position)
                const homeClass = homeTeam === ev.scoringTeam.name ? 'scoring-team' : 'conceding-team'
                const awayClass = awayTeam === ev.scoringTeam.name ? 'scoring-team' : 'conceding-team'

                teamDisplay = `<span class="${homeClass}">${homeTeam}</span> <span class="vs-text">vs</span> <span class="${awayClass}">${awayTeam}</span>`
              } else {
                // Fallback: use alphabetical ordering as home/away, bold the scoring team
                const teams = [ev.scoringTeam.name, ev.concedingTeam.name].sort()
                const homeTeam = teams[0]
                const awayTeam = teams[1]

                const homeClass = homeTeam === ev.scoringTeam.name ? 'scoring-team' : 'conceding-team'
                const awayClass = awayTeam === ev.scoringTeam.name ? 'scoring-team' : 'conceding-team'

                teamDisplay = `<span class="${homeClass}">${homeTeam}</span> <span class="vs-text">vs</span> <span class="${awayClass}">${awayTeam}</span>`
              }

              // Add current score if available for history
              let currentScore = ''
              if (ev.scoreAfterEvent && ev.scoreAfterEvent.home != null && ev.scoreAfterEvent.away != null) {
                currentScore = ` <span class="current-score">${ev.scoreAfterEvent.home}-${ev.scoreAfterEvent.away}</span>`
              }

              const scorer = `<span class="goal-scorer">${ev.scorer.name}</span>`

              // Add Dream League Fantasy Football information for history
              let dreamLeagueInfo = ''
              if (ev.potentialGoalFor) {
                const substitute = ev.potentialGoalFor.substitute ? ' (SUB)' : ''
                dreamLeagueInfo += `<div class="dream-league-info potential-goal">Potential goal for <strong>${ev.potentialGoalFor.manager}</strong>${substitute}</div>`
              }
              if (ev.potentialConcedingFor) {
                const substitute = ev.potentialConcedingFor.substitute ? ' (SUB)' : ''
                dreamLeagueInfo += `<div class="dream-league-info potential-concede">Potential concede for <strong>${ev.potentialConcedingFor.manager}</strong>${substitute}</div>`
              }

              li.innerHTML = `
                <div class="goal-header">
                  ${minute}${teamDisplay}${currentScore}
                </div>
                <div class="goal-details">
                  ${scorer}${dreamLeagueInfo}
                </div>
              `
              list.prepend(li)
            })
            toggleEmptyState()
          }
        }).catch(() => {})
    } else {
      // On reconnection, fetch any missed events
      fetchMissedEvents()
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

  // Initialize empty state on load
  toggleEmptyState()
  connect()
})()
