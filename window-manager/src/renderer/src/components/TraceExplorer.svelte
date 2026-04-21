<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { TurnRecord, LogEvent } from '../types'

  let turns = $state<TurnRecord[]>([])
  let statusFilter = $state<string>('all')
  let typeFilter = $state<string>('all')
  let expandedTurnId = $state<string | null>(null)
  let turnEvents = $state<Map<string, LogEvent[]>>(new Map())

  const filteredTurns = $derived(turns.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (typeFilter !== 'all' && t.turn_type !== typeFilter) return false
    return true
  }))

  async function loadTurns() {
    try {
      turns = await window.api.listTurns({ limit: 100 })
    } catch {
      // keep last-known turns on error
    }
  }

  async function expandTurn(turnId: string) {
    if (expandedTurnId === turnId) { expandedTurnId = null; return }
    expandedTurnId = turnId
    if (!turnEvents.has(turnId)) {
      try {
        const events = await window.api.getTurnEvents(turnId)
        turnEvents = new Map(turnEvents).set(turnId, events)
      } catch {
        expandedTurnId = null
      }
    }
  }

  let offStarted: () => void
  let offUpdated: () => void
  let offEvent: () => void

  onMount(() => {
    loadTurns()
    offStarted = window.api.onTurnStarted((t: unknown) => {
      turns = [t as TurnRecord, ...turns]
    })
    offUpdated = window.api.onTurnUpdated((patch: unknown) => {
      const p = patch as Partial<TurnRecord> & { id: string }
      turns = turns.map(t => t.id === p.id ? { ...t, ...p } : t)
    })
    offEvent = window.api.onTurnEvent((e: unknown) => {
      const ev = e as LogEvent
      if (expandedTurnId === ev.turnId) {
        const existing = turnEvents.get(ev.turnId) ?? []
        turnEvents = new Map(turnEvents).set(ev.turnId, [...existing, ev])
      }
    })
  })
  onDestroy(() => { offStarted?.(); offUpdated?.(); offEvent?.() })
</script>

<div class="trace-explorer">
  <div class="filters">
    <label for="status-filter">Status</label>
    <select id="status-filter" bind:value={statusFilter} aria-label="status">
      <option value="all">All</option>
      <option value="running">Running</option>
      <option value="success">Success</option>
      <option value="error">Error</option>
    </select>

    <label for="type-filter">Type</label>
    <select id="type-filter" bind:value={typeFilter} aria-label="type">
      <option value="all">All</option>
      <option value="human-claude">human-claude</option>
      <option value="shellephant-claude">shellephant-claude</option>
    </select>
  </div>

  <table class="turns-table">
    <thead>
      <tr>
        <th>Type</th>
        <th>Status</th>
        <th>Duration</th>
        <th>Started</th>
      </tr>
    </thead>
    <tbody>
      {#each filteredTurns as turn (turn.id)}
        <tr onclick={() => expandTurn(turn.id)}
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && expandTurn(turn.id)}
            tabindex="0" class="turn-row {turn.status}">
          <td>{turn.turn_type === 'human-claude' ? 'human→claude' : 'shellephant→claude'}</td>
          <td><span class="status-dot {turn.status}">{turn.status}</span></td>
          <td>{turn.duration_ms != null ? `${turn.duration_ms}ms` : '—'}</td>
          <td>{new Date(turn.started_at).toLocaleTimeString()}</td>
        </tr>
        {#if expandedTurnId === turn.id}
          <tr class="events-row">
            <td colspan="4">
              <div class="event-list">
                {#each turnEvents.get(turn.id) ?? [] as ev (ev.ts + ev.eventType)}
                  <div class="event-item {ev.eventType.includes('error') ? 'error' : ''}">
                    <span class="ev-type">{ev.eventType}</span>
                    {#if ev.payload?.durationMs != null}
                      <span class="ev-dur">{ev.payload.durationMs}ms</span>
                    {/if}
                    {#if ev.payload?.error}
                      <span class="ev-error">{ev.payload.error}</span>
                    {/if}
                    <span class="ev-ts">{new Date(ev.ts).toLocaleTimeString()}</span>
                  </div>
                {/each}
              </div>
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
</div>

<style>
  .trace-explorer { padding: 16px; display: flex; flex-direction: column; gap: 12px; overflow: auto; height: 100%; }
  .filters { display: flex; gap: 12px; align-items: center; }
  .turns-table { width: 100%; border-collapse: collapse; }
  .turns-table th, .turns-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #333; }
  .turn-row { cursor: pointer; }
  .turn-row:hover { background: #2a2a2a; }
  .turn-row:focus-visible { outline: 2px solid var(--accent, #7ed321); outline-offset: -1px; }
  .status-dot { font-size: 12px; }
  .status-dot.running { color: #f5a623; }
  .status-dot.success { color: #7ed321; }
  .status-dot.error { color: #d0021b; }
  .event-list { padding: 8px 0; display: flex; flex-direction: column; gap: 4px; }
  .event-item { display: flex; gap: 12px; font-size: 12px; font-family: monospace; padding: 2px 8px; }
  .event-item.error { background: #2d1515; color: #ff6b6b; }
  .ev-type { font-weight: 600; min-width: 100px; }
  .ev-error { color: #ff6b6b; flex: 1; }
</style>
