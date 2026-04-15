import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import WindowDetailPane from '../../src/renderer/src/components/WindowDetailPane.svelte'
import type { ConversationSummary } from '../../src/renderer/src/lib/conversationSummary'

const getCurrentBranch = vi.fn()
const sendTerminalInput = vi.fn()
const getGitStatus = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  getCurrentBranch.mockReset()
  sendTerminalInput.mockReset()
  getGitStatus.mockReset()
  getGitStatus.mockResolvedValue({ isDirty: false, added: 0, deleted: 0 })
  // @ts-expect-error test bridge
  globalThis.window.api = { getCurrentBranch, sendTerminalInput, getGitStatus }
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

  it('renders Terminal, Editor, and Both toggle buttons', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /terminal/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /both/i })).toBeInTheDocument()
  })

  it('marks the active viewMode button with aria-pressed', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project, viewMode: 'editor' } })
    expect(screen.getByRole('button', { name: /editor/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /terminal/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onViewChange with the clicked mode', async () => {
    getCurrentBranch.mockResolvedValue('main')
    const onViewChange = vi.fn()
    render(WindowDetailPane, { props: { win, project, viewMode: 'terminal', onViewChange } })
    await fireEvent.click(screen.getByRole('button', { name: /editor/i }))
    expect(onViewChange).toHaveBeenCalledWith('editor')
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

  it('does not render summary row when summary prop is undefined', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    expect(document.querySelector('.summary-row')).toBeNull()
  })

  it('renders summary title when summary prop is provided', () => {
    getCurrentBranch.mockResolvedValue('main')
    const summary: ConversationSummary = { title: 'Fixed auth bug', bullets: ['updated middleware'] }
    render(WindowDetailPane, { props: { win, project, summary } })
    expect(screen.getByText('Fixed auth bug')).toBeInTheDocument()
  })

  it('renders all summary bullets when summary prop is provided', () => {
    getCurrentBranch.mockResolvedValue('main')
    const summary: ConversationSummary = {
      title: 'Built feature',
      bullets: ['added endpoint', 'wrote tests', 'updated docs']
    }
    render(WindowDetailPane, { props: { win, project, summary } })
    expect(screen.getByText('added endpoint')).toBeInTheDocument()
    expect(screen.getByText('wrote tests')).toBeInTheDocument()
    expect(screen.getByText('updated docs')).toBeInTheDocument()
  })

  describe('git status display', () => {

    it('shows nothing extra before first poll resolves', () => {
      getCurrentBranch.mockResolvedValue('main')
      getGitStatus.mockResolvedValue({ isDirty: false, added: 0, deleted: 0 })
      render(WindowDetailPane, { props: { win, project } })
      expect(document.querySelector('.git-stat')).toBeNull()
      expect(document.querySelector('.git-clean')).toBeNull()
    })

    it('shows (clean) when isDirty is false after poll', async () => {
      getCurrentBranch.mockResolvedValue('main')
      getGitStatus.mockResolvedValue({ isDirty: false, added: 0, deleted: 0 })
      render(WindowDetailPane, { props: { win, project } })
      await vi.runOnlyPendingTimersAsync()
      expect(await screen.findByText('(clean)')).toBeInTheDocument()
    })

    it('shows +N −N when isDirty with counts', async () => {
      getCurrentBranch.mockResolvedValue('main')
      getGitStatus.mockResolvedValue({ isDirty: true, added: 12, deleted: 5 })
      render(WindowDetailPane, { props: { win, project } })
      await vi.runOnlyPendingTimersAsync()
      expect(await screen.findByText('+12 −5')).toBeInTheDocument()
    })

    it('shows nothing extra when isDirty with 0/0 counts', async () => {
      getCurrentBranch.mockResolvedValue('main')
      getGitStatus.mockResolvedValue({ isDirty: true, added: 0, deleted: 0 })
      render(WindowDetailPane, { props: { win, project } })
      await vi.runOnlyPendingTimersAsync()
      expect(document.querySelector('.git-stat')).toBeNull()
      expect(document.querySelector('.git-clean')).toBeNull()
    })

    it('fires onGitStatus callback with status after each poll', async () => {
      getCurrentBranch.mockResolvedValue('main')
      const status = { isDirty: true, added: 3, deleted: 1 }
      getGitStatus.mockResolvedValue(status)
      const onGitStatus = vi.fn()
      render(WindowDetailPane, { props: { win, project, onGitStatus } })
      await vi.runOnlyPendingTimersAsync()
      expect(onGitStatus).toHaveBeenCalledWith(status)
    })
  })
})
