import { render, screen, cleanup } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import TraceExplorer from '../../src/renderer/src/components/TraceExplorer.svelte'
import type { TurnRecord, LogEvent } from '../../src/renderer/src/types'

const mockTurns: TurnRecord[] = [
  { id: 't1', window_id: 1, turn_type: 'human-claude', status: 'success',
    started_at: 1000000, ended_at: 1002000, duration_ms: 2000, log_file: '/tmp/x.jsonl' },
  { id: 't2', window_id: 2, turn_type: 'shellephant-claude', status: 'error',
    started_at: 1005000, error: 'docker failed', log_file: '/tmp/x.jsonl' }
]

const mockEvents: LogEvent[] = [
  { turnId: 't1', windowId: 1, eventType: 'exec_start', ts: 1000100 },
  { turnId: 't1', windowId: 1, eventType: 'exec_end', ts: 1001900, payload: { durationMs: 1800 } }
]

const listTurns = vi.fn()
const getTurnEvents = vi.fn()
const onTurnStarted = vi.fn()
const onTurnUpdated = vi.fn()
const onTurnEvent = vi.fn()

beforeEach(() => {
  listTurns.mockResolvedValue(mockTurns)
  getTurnEvents.mockResolvedValue(mockEvents)
  onTurnStarted.mockReturnValue(vi.fn())
  onTurnUpdated.mockReturnValue(vi.fn())
  onTurnEvent.mockReturnValue(vi.fn())
  // @ts-expect-error test bridge
  globalThis.window.api = {
    listTurns,
    getTurnEvents,
    onTurnStarted,
    onTurnUpdated,
    onTurnEvent
  }
})

afterEach(() => {
  cleanup()
})

describe('TraceExplorer', () => {
  it('renders turn list from listTurns', async () => {
    render(TraceExplorer, { props: {} })
    await screen.findByText('human→claude')
    expect(screen.getByText('shellephant→claude')).toBeInTheDocument()
  })

  it('shows status for each turn', async () => {
    render(TraceExplorer, { props: {} })
    await screen.findByText('success')
    expect(screen.getByText('error')).toBeInTheDocument()
  })

  it('status filter hides non-matching turns', async () => {
    render(TraceExplorer, { props: {} })
    await screen.findByText('human→claude')
    const statusSelect = screen.getByLabelText(/status/i)
    await userEvent.selectOptions(statusSelect, 'error')
    expect(screen.queryByText('success')).not.toBeInTheDocument()
    expect(screen.getByText('error')).toBeInTheDocument()
  })

  it('clicking a turn row fetches and shows events', async () => {
    render(TraceExplorer, { props: {} })
    await screen.findByText('human→claude')
    await userEvent.click(screen.getAllByRole('row')[1]) // first data row
    await screen.findByText('exec_start')
    expect(screen.getByText('exec_end')).toBeInTheDocument()
  })

  it('onTurnStarted push adds new turn to list', async () => {
    let startedCb: ((t: unknown) => void) | undefined
    onTurnStarted.mockImplementation((cb: (t: unknown) => void) => {
      startedCb = cb
      return vi.fn()
    })
    render(TraceExplorer, { props: {} })
    await screen.findByText('human→claude')
    const newTurn: TurnRecord = { id: 't3', window_id: 3, turn_type: 'human-claude',
      status: 'running', started_at: Date.now(), log_file: '/tmp/x.jsonl' }
    startedCb?.(newTurn)
    await screen.findAllByText('human→claude')
    expect(screen.getAllByText('human→claude')).toHaveLength(2)
  })
})
