import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import WindowDetailPane from '../../src/renderer/src/components/WindowDetailPane.svelte'

const getCurrentBranch = vi.fn()
const sendTerminalInput = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  getCurrentBranch.mockReset()
  sendTerminalInput.mockReset()
  // @ts-expect-error test bridge
  globalThis.window.api = { getCurrentBranch, sendTerminalInput }
})
afterEach(() => vi.useRealTimers())

const win = {
  id: 1,
  name: 'My Feature',
  project_id: 7,
  container_id: 'abc123def456',
  created_at: '2026-04-14T00:00:00Z',
  status: 'running' as const
}

const winWithPorts = {
  ...win,
  ports: JSON.stringify({ '3000': '54321', '8080': '54322' })
}
const project = {
  id: 7,
  name: 'my-project',
  git_url: 'git@github.com:org/my-repo.git',
  created_at: '2026-04-14T00:00:00Z'
}

describe('WindowDetailPane', () => {
  it('renders window name, project name, and status', async () => {
    getCurrentBranch.mockResolvedValue('my-feature')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByText('My Feature')).toBeInTheDocument()
    expect(screen.getByText('my-project')).toBeInTheDocument()
    expect(screen.getByText(/running/i)).toBeInTheDocument()
  })

  it('renders the branch after the initial poll', async () => {
    getCurrentBranch.mockResolvedValue('my-feature')
    render(WindowDetailPane, { props: { win, project } })
    await vi.runOnlyPendingTimersAsync()
    expect(await screen.findByText('my-feature')).toBeInTheDocument()
  })

  it('polls the branch every 5 seconds', async () => {
    getCurrentBranch.mockResolvedValueOnce('my-feature').mockResolvedValueOnce('other')
    render(WindowDetailPane, { props: { win, project } })
    // Advance 5 s once: this fires the interval tick + flushes the initial
    // onMount microtask, producing two calls and leaving the UI on 'other'.
    await vi.advanceTimersByTimeAsync(5000)
    expect(screen.getByText('other')).toBeInTheDocument()
    expect(getCurrentBranch).toHaveBeenCalledTimes(2)
  })

  it('keeps the last branch on error (does not blank out)', async () => {
    getCurrentBranch
      .mockResolvedValueOnce('my-feature')
      .mockRejectedValueOnce(new Error('docker down'))
    render(WindowDetailPane, { props: { win, project } })
    await vi.runOnlyPendingTimersAsync()
    expect(await screen.findByText('my-feature')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(5000)
    expect(screen.getByText('my-feature')).toBeInTheDocument()
  })

  it('renders a Commit button and a Push button, disabled by default (Phase 2)', () => {
    getCurrentBranch.mockResolvedValue('my-feature')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /commit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /push/i })).toBeInTheDocument()
  })

  it('invokes onCommit when the Commit button is clicked', async () => {
    getCurrentBranch.mockResolvedValue('x')
    const onCommit = vi.fn()
    render(WindowDetailPane, { props: { win, project, onCommit, commitDisabled: false } })
    await fireEvent.click(screen.getByRole('button', { name: /commit/i }))
    expect(onCommit).toHaveBeenCalled()
  })

  it('invokes onPush when the Push button is clicked', async () => {
    getCurrentBranch.mockResolvedValue('x')
    const onPush = vi.fn()
    render(WindowDetailPane, { props: { win, project, onPush, pushDisabled: false } })
    await fireEvent.click(screen.getByRole('button', { name: /push/i }))
    expect(onPush).toHaveBeenCalled()
  })

  it('honors commitDisabled and pushDisabled', () => {
    getCurrentBranch.mockResolvedValue('x')
    render(WindowDetailPane, { props: { win, project, commitDisabled: true, pushDisabled: true } })
    expect(screen.getByRole('button', { name: /commit/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /push/i })).toBeDisabled()
  })

  it('renders a Claude button', () => {
    getCurrentBranch.mockResolvedValue('x')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /claude/i })).toBeInTheDocument()
  })

  it('Claude button is disabled when container is not running', () => {
    getCurrentBranch.mockResolvedValue('x')
    const stoppedWin = { ...win, status: 'stopped' as const }
    render(WindowDetailPane, { props: { win: stoppedWin, project } })
    expect(screen.getByRole('button', { name: /claude/i })).toBeDisabled()
  })

  it('Claude button is disabled when container status is unknown', () => {
    getCurrentBranch.mockResolvedValue('x')
    const unknownWin = { ...win, status: 'unknown' as const }
    render(WindowDetailPane, { props: { win: unknownWin, project } })
    expect(screen.getByRole('button', { name: /claude/i })).toBeDisabled()
  })

  it('Claude button is enabled when container is running', () => {
    getCurrentBranch.mockResolvedValue('x')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /claude/i })).not.toBeDisabled()
  })

  it('clicking Claude button sends the inject command to the terminal', async () => {
    getCurrentBranch.mockResolvedValue('x')
    render(WindowDetailPane, { props: { win, project } })
    await fireEvent.click(screen.getByRole('button', { name: /claude/i }))
    expect(sendTerminalInput).toHaveBeenCalledWith(
      'abc123def456',
      '\x15claude --dangerously-skip-permissions\n'
    )
  })

  it('does not render port arrows when window has no ports', () => {
    getCurrentBranch.mockResolvedValue('x')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })

  it('renders port mappings when window has ports', () => {
    getCurrentBranch.mockResolvedValue('x')
    render(WindowDetailPane, { props: { win: winWithPorts, project } })
    expect(screen.getByText(':3000→:54321')).toBeInTheDocument()
    expect(screen.getByText(':8080→:54322')).toBeInTheDocument()
  })

  it('renders nothing for malformed ports JSON', () => {
    getCurrentBranch.mockResolvedValue('x')
    const badWin = { ...win, ports: 'not-valid-json' }
    render(WindowDetailPane, { props: { win: badWin, project } })
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })
})
