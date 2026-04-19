import { writable } from 'svelte/store'

const mockPanelLayoutStore = writable({
  panels: [
    { id: 'claude',   visible: true,  width: 50 },
    { id: 'terminal', visible: false, width: 0  },
    { id: 'editor',   visible: true,  width: 50 }
  ]
})
const mockTogglePanel = vi.fn()

vi.mock('../../src/renderer/src/lib/panelLayout', () => ({
  panelLayout: { subscribe: (...args: unknown[]) => mockPanelLayoutStore.subscribe(args[0] as Parameters<typeof mockPanelLayoutStore.subscribe>[0]) },
  togglePanel: (...args: unknown[]) => mockTogglePanel(...args)
}))

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/svelte'
import { tick } from 'svelte'
import WindowDetailPane from '../../src/renderer/src/components/WindowDetailPane.svelte'
import type { ConversationSummary } from '../../src/renderer/src/lib/conversationSummary'
import type { WindowDependencyContainer } from '../../src/renderer/src/types'

const getCurrentBranch = vi.fn()
const sendTerminalInput = vi.fn()
const getGitStatus = vi.fn()

let mockListWindowDeps: ReturnType<typeof vi.fn>
let mockStartDepLogs: ReturnType<typeof vi.fn>
let mockStopDepLogs: ReturnType<typeof vi.fn>
let mockOnDepLogsData: ReturnType<typeof vi.fn>
let mockOffDepLogsData: ReturnType<typeof vi.fn>
let mockGetDepContainersStatus: ReturnType<typeof vi.fn>
let mockGetPhoneServerStatus: ReturnType<typeof vi.fn>
let mockStartPhoneServer: ReturnType<typeof vi.fn>
let mockStopPhoneServer: ReturnType<typeof vi.fn>
let mockOpenExternal: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  getCurrentBranch.mockReset()
  sendTerminalInput.mockReset()
  getGitStatus.mockReset()
  getGitStatus.mockResolvedValue({ isDirty: false, added: 0, deleted: 0 })
  mockTogglePanel.mockReset()
  mockPanelLayoutStore.set({
    panels: [
      { id: 'claude',   visible: true,  width: 50 },
      { id: 'terminal', visible: false, width: 0  },
      { id: 'editor',   visible: true,  width: 50 }
    ]
  })
  mockListWindowDeps = vi.fn().mockResolvedValue([])
  mockStartDepLogs = vi.fn().mockResolvedValue(undefined)
  mockStopDepLogs = vi.fn()
  mockOnDepLogsData = vi.fn()
  mockOffDepLogsData = vi.fn()
  mockGetDepContainersStatus = vi.fn().mockResolvedValue({})
  mockGetPhoneServerStatus = vi.fn().mockResolvedValue({ active: false, url: undefined })
  mockStartPhoneServer = vi.fn().mockResolvedValue({ url: 'http://localhost:4000' })
  mockStopPhoneServer = vi.fn().mockResolvedValue(undefined)
  mockOpenExternal = vi.fn()
  // @ts-expect-error test bridge
  globalThis.window.api = {
    getCurrentBranch,
    sendTerminalInput,
    getGitStatus,
    listWindowDeps: mockListWindowDeps,
    startDepLogs: mockStartDepLogs,
    stopDepLogs: mockStopDepLogs,
    onDepLogsData: mockOnDepLogsData,
    offDepLogsData: mockOffDepLogsData,
    getDepContainersStatus: mockGetDepContainersStatus,
    getPhoneServerStatus: mockGetPhoneServerStatus,
    startPhoneServer: mockStartPhoneServer,
    stopPhoneServer: mockStopPhoneServer,
    openExternal: mockOpenExternal
  }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const win = {
  id: 1,
  name: 'My Feature',
  project_id: 7,
  container_id: 'abc123def456',
  created_at: '2026-04-14T00:00:00Z',
  status: 'running' as const,
  projects: [] as import('../../src/renderer/src/types').WindowProjectRecord[]
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

  it('renders Claude, Terminal, and Editor toggle buttons in order', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    const buttons = screen.getAllByRole('button', { name: /^(claude|terminal|editor)$/i })
    expect(buttons[0]).toHaveAccessibleName(/claude/i)
    expect(buttons[1]).toHaveAccessibleName(/terminal/i)
    expect(buttons[2]).toHaveAccessibleName(/editor/i)
    expect(screen.queryByRole('button', { name: /both/i })).not.toBeInTheDocument()
  })

  it('claude button aria-pressed true when claude visible in store', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /^claude$/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^terminal$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^editor$/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('calling togglePanel when a toggle button is clicked', async () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
    expect(mockTogglePanel).toHaveBeenCalledWith('terminal')
  })

  it('toggle button disabled when it is the only visible panel', () => {
    getCurrentBranch.mockResolvedValue('main')
    mockPanelLayoutStore.set({
      panels: [
        { id: 'claude',   visible: true,  width: 100 },
        { id: 'terminal', visible: false, width: 0   },
        { id: 'editor',   visible: false, width: 0   }
      ]
    })
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /^claude$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^terminal$/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /^editor$/i })).not.toBeDisabled()
  })

  it('updates aria-pressed when store changes after mount', async () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /^terminal$/i })).toHaveAttribute('aria-pressed', 'false')
    mockPanelLayoutStore.set({
      panels: [
        { id: 'claude',   visible: true,  width: 33 },
        { id: 'terminal', visible: true,  width: 33 },
        { id: 'editor',   visible: true,  width: 34 }
      ]
    })
    await tick()
    expect(screen.getByRole('button', { name: /^terminal$/i })).toHaveAttribute('aria-pressed', 'true')
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

  describe('dep logs tab', () => {
    it('does not show Dep Logs button when no dep containers', async () => {
      mockListWindowDeps.mockResolvedValue([])
      render(WindowDetailPane, { props: { win, project } })
      // flush the onMount async call
      await tick()
      await tick()
      expect(mockListWindowDeps).toHaveBeenCalledWith(1)
      expect(screen.queryByRole('button', { name: /dep logs/i })).toBeNull()
    })

    it('shows Dep Logs button when dep containers exist', async () => {
      const depContainers: WindowDependencyContainer[] = [
        { id: 1, window_id: 1, dependency_id: 1, container_id: 'dep-ctr', image: 'redis', tag: 'latest' }
      ]
      mockListWindowDeps.mockResolvedValue(depContainers)
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      expect(screen.getByRole('button', { name: /dep logs/i })).toBeDefined()
    })

    it('clicking Dep Logs calls startDepLogs and shows log area', async () => {
      const depContainers: WindowDependencyContainer[] = [
        { id: 1, window_id: 1, dependency_id: 1, container_id: 'dep-ctr', image: 'redis', tag: 'latest' }
      ]
      mockListWindowDeps.mockResolvedValue(depContainers)
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      await fireEvent.click(screen.getByRole('button', { name: /dep logs/i }))
      await tick()
      expect(mockStartDepLogs).toHaveBeenCalledWith(1, 'dep-ctr')
      expect(screen.getByRole('region', { name: /dep logs/i })).toBeDefined()
    })

    it('clicking Dep Logs again hides the area and calls stopDepLogs', async () => {
      const depContainers: WindowDependencyContainer[] = [
        { id: 1, window_id: 1, dependency_id: 1, container_id: 'dep-ctr', image: 'redis', tag: 'latest' }
      ]
      mockListWindowDeps.mockResolvedValue(depContainers)
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      await fireEvent.click(screen.getByRole('button', { name: /dep logs/i }))
      await tick()
      await fireEvent.click(screen.getByRole('button', { name: /dep logs/i }))
      await tick()
      expect(mockStopDepLogs).toHaveBeenCalledWith('dep-ctr')
      expect(screen.queryByRole('region', { name: /dep logs/i })).toBeNull()
    })
  })

  describe('dep container status indicator', () => {
    const depContainers: WindowDependencyContainer[] = [
      { id: 1, window_id: 1, dependency_id: 1, container_id: 'ctr-1', image: 'redis', tag: 'latest' },
      { id: 2, window_id: 1, dependency_id: 2, container_id: 'ctr-2', image: 'postgres', tag: '15' }
    ]

    it('does not call getDepContainersStatus when no dep containers', async () => {
      mockListWindowDeps.mockResolvedValue([])
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      expect(mockGetDepContainersStatus).not.toHaveBeenCalled()
    })

    it('calls getDepContainersStatus on mount when dep containers exist', async () => {
      mockListWindowDeps.mockResolvedValue(depContainers)
      mockGetDepContainersStatus.mockResolvedValue({ 'ctr-1': 'running', 'ctr-2': 'stopped' })
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      expect(mockGetDepContainersStatus).toHaveBeenCalledWith(['ctr-1', 'ctr-2'])
    })

    it('shows ▶ prefix for running container in dropdown', async () => {
      mockListWindowDeps.mockResolvedValue(depContainers)
      mockGetDepContainersStatus.mockResolvedValue({ 'ctr-1': 'running', 'ctr-2': 'stopped' })
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      // Toggle dep logs to show the dropdown
      await fireEvent.click(screen.getByRole('button', { name: /dep logs/i }))
      await tick()
      // The select options should have status prefixes
      const options = document.querySelectorAll('.dep-selector option')
      expect(options[0].textContent).toContain('▶')
      expect(options[1].textContent).toContain('■')
    })

    it('polls getDepContainersStatus every 5 seconds', async () => {
      mockListWindowDeps.mockResolvedValue(depContainers)
      mockGetDepContainersStatus.mockResolvedValue({ 'ctr-1': 'running', 'ctr-2': 'running' })
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      expect(mockGetDepContainersStatus).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockGetDepContainersStatus).toHaveBeenCalledTimes(2)
    })

    it('shows ? prefix for unknown status', async () => {
      mockListWindowDeps.mockResolvedValue(depContainers)
      mockGetDepContainersStatus.mockResolvedValue({ 'ctr-1': 'unknown', 'ctr-2': 'unknown' })
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      await tick()
      await fireEvent.click(screen.getByRole('button', { name: /dep logs/i }))
      await tick()
      const options = document.querySelectorAll('.dep-selector option')
      expect(options[0].textContent).toContain('?')
      expect(options[1].textContent).toContain('?')
    })
  })

  const baseProps = { win, project }

  describe('Phone server toggle', () => {
    it('shows Phone button in toggle row', async () => {
      render(WindowDetailPane, { props: baseProps })
      await screen.findByRole('button', { name: 'Phone Access' })
    })

    it('starts server and shows URL on click', async () => {
      mockStartPhoneServer.mockResolvedValue({ url: 'http://100.1.2.3:8765' })
      render(WindowDetailPane, { props: baseProps })
      const btn = await screen.findByRole('button', { name: 'Phone Access' })
      await fireEvent.click(btn)
      await screen.findByTitle('http://100.1.2.3:8765')
    })

    it('stops server and hides URL on second click', async () => {
      mockGetPhoneServerStatus.mockResolvedValue({ active: true, url: 'http://100.1.2.3:8765' })
      render(WindowDetailPane, { props: baseProps })
      await screen.findByTitle('http://100.1.2.3:8765')
      mockStopPhoneServer.mockResolvedValue(undefined)
      const btn = await screen.findByRole('button', { name: 'Phone Access' })
      await fireEvent.click(btn)
      await waitFor(() => {
        expect(screen.queryByTitle('http://100.1.2.3:8765')).toBeNull()
      })
    })

    it('shows error message when start fails', async () => {
      mockStartPhoneServer.mockRejectedValue(new Error('Tailscale IP not found'))
      render(WindowDetailPane, { props: baseProps })
      const btn = await screen.findByRole('button', { name: 'Phone Access' })
      await fireEvent.click(btn)
      await screen.findByText('Tailscale IP not found')
    })
  })

  describe('multi-project window', () => {
    const multiWin = {
      id: 2,
      name: 'Multi Window',
      project_id: null,
      container_id: 'multi123',
      created_at: '2026-04-14T00:00:00Z',
      status: 'running' as const,
      projects: [
        { id: 10, window_id: 2, project_id: 1, clone_path: '/workspace/repo-a', project_name: 'Repo A' },
        { id: 11, window_id: 2, project_id: 2, clone_path: '/workspace/repo-b', project_name: 'Repo B' }
      ]
    }

    it('renders project rows for multi-project window', async () => {
      getCurrentBranch.mockResolvedValue('main')
      render(WindowDetailPane, { props: { win: multiWin, project: null } })
      await tick()
      const rows = document.querySelectorAll('.project-row')
      expect(rows).toHaveLength(2)
    })

    it('shows project name in row label', async () => {
      getCurrentBranch.mockResolvedValue('main')
      render(WindowDetailPane, { props: { win: multiWin, project: null } })
      await tick()
      expect(screen.getByText('Repo A')).toBeInTheDocument()
      expect(screen.getByText('Repo B')).toBeInTheDocument()
    })

    it('Commit button calls onCommitProject with projectId and clonePath', async () => {
      getCurrentBranch.mockResolvedValue('main')
      const onCommitProject = vi.fn()
      render(WindowDetailPane, { props: { win: multiWin, project: null, onCommitProject } })
      await tick()
      const rows = document.querySelectorAll('.project-row')
      const commitBtn = within(rows[0] as HTMLElement).getByRole('button', { name: /commit/i })
      await fireEvent.click(commitBtn)
      expect(onCommitProject).toHaveBeenCalledWith(1, '/workspace/repo-a')
    })

    it('Push button calls onPushProject with projectId and clonePath', async () => {
      getCurrentBranch.mockResolvedValue('main')
      const onPushProject = vi.fn()
      render(WindowDetailPane, { props: { win: multiWin, project: null, onPushProject } })
      await tick()
      const rows = document.querySelectorAll('.project-row')
      const pushBtn = within(rows[0] as HTMLElement).getByRole('button', { name: /push/i })
      await fireEvent.click(pushBtn)
      expect(onPushProject).toHaveBeenCalledWith(1, '/workspace/repo-a')
    })

    it('does not render project rows for single-project window', async () => {
      getCurrentBranch.mockResolvedValue('main')
      render(WindowDetailPane, { props: { win, project } })
      await tick()
      expect(document.querySelector('.project-row')).toBeNull()
    })
  })
})
