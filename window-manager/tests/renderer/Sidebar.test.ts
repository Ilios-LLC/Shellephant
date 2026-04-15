import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../../src/renderer/src/components/Sidebar.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'
import type { ProjectGroupRecord } from '../../src/renderer/src/types'
import { waitingWindows } from '../../src/renderer/src/lib/waitingWindows'
import type { WaitingEntry } from '../../src/renderer/src/lib/waitingWindows'

function makeProject(id: number, name: string): ProjectRecord {
  return {
    id,
    name,
    git_url: `git@github.com:org/${name}.git`,
    created_at: '2026-01-01T00:00:00Z'
  }
}

describe('Sidebar', () => {
  let onProjectSelect: ReturnType<typeof vi.fn>
  let onRequestNewProject: ReturnType<typeof vi.fn>
  let onRequestSettings: ReturnType<typeof vi.fn>
  let onRequestHome: ReturnType<typeof vi.fn>
  let onWaitingWindowSelect: ReturnType<typeof vi.fn>
  let onGroupSelect: ReturnType<typeof vi.fn>
  let onGroupCreated: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onProjectSelect = vi.fn()
    onRequestNewProject = vi.fn()
    onRequestSettings = vi.fn()
    onRequestHome = vi.fn()
    onWaitingWindowSelect = vi.fn()
    onGroupSelect = vi.fn()
    onGroupCreated = vi.fn()
    vi.stubGlobal('api', { createGroup: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function baseProps(overrides: Record<string, unknown> = {}) {
    return {
      projects: [] as ProjectRecord[],
      selectedProjectId: null as number | null,
      groups: [] as ProjectGroupRecord[],
      activeGroupId: null as number | null,
      onProjectSelect,
      onRequestNewProject,
      onRequestSettings,
      onRequestHome,
      onWaitingWindowSelect,
      onGroupSelect,
      onGroupCreated,
      ...overrides
    }
  }

  it('renders an item per project', () => {
    render(Sidebar, baseProps({ projects: [makeProject(1, 'alpha'), makeProject(2, 'beta')] }))
    expect(screen.getByText('alpha')).toBeDefined()
    expect(screen.getByText('beta')).toBeDefined()
  })

  it('shows empty hint when projects is empty', () => {
    render(Sidebar, baseProps())
    expect(screen.getByText(/no projects/i)).toBeDefined()
  })

  it('clicking a project forwards to onProjectSelect', async () => {
    const p = makeProject(3, 'gamma')
    render(Sidebar, baseProps({ projects: [p] }))
    await fireEvent.click(screen.getByText('gamma'))
    expect(onProjectSelect).toHaveBeenCalledWith(p)
  })

  it('passes selected state to the correct item', () => {
    const a = makeProject(1, 'a')
    const b = makeProject(2, 'b')
    const { container } = render(Sidebar, baseProps({ projects: [a, b], selectedProjectId: 2 }))
    const items = container.querySelectorAll('[data-testid="project-item"]')
    expect(items[0].classList.contains('selected')).toBe(false)
    expect(items[1].classList.contains('selected')).toBe(true)
  })

  it('renders Shellephant home link and calls onRequestHome when clicked', async () => {
    render(Sidebar, baseProps())
    const homeBtn = screen.getByRole('button', { name: /shellephant/i })
    expect(homeBtn).toBeDefined()
    await fireEvent.click(homeBtn)
    expect(onRequestHome).toHaveBeenCalled()
  })

  it('clicking the new-project button calls onRequestNewProject', async () => {
    render(Sidebar, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /new project/i }))
    expect(onRequestNewProject).toHaveBeenCalled()
  })

  it('clicking the settings button calls onRequestSettings', async () => {
    render(Sidebar, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(onRequestSettings).toHaveBeenCalled()
  })

  describe('waiting section', () => {
    beforeEach(() => waitingWindows._resetForTest())

    it('does not render the waiting section when no windows are waiting', () => {
      render(Sidebar, baseProps())
      expect(screen.queryByText(/waiting/i)).toBeNull()
    })

    it('renders the waiting section when a window is waiting', () => {
      const entry: WaitingEntry = {
        containerId: 'c1',
        windowId: 1,
        windowName: 'my-window',
        projectId: 1,
        projectName: 'my-project'
      }
      waitingWindows.add(entry)
      render(Sidebar, baseProps())
      expect(screen.getByText(/waiting/i)).toBeDefined()
      expect(screen.getByText('my-project / my-window')).toBeDefined()
    })

    it('clicking a waiting item calls onWaitingWindowSelect with the entry', async () => {
      const entry: WaitingEntry = {
        containerId: 'c1',
        windowId: 1,
        windowName: 'my-window',
        projectId: 1,
        projectName: 'my-project'
      }
      waitingWindows.add(entry)
      render(Sidebar, baseProps())
      await fireEvent.click(screen.getByText('my-project / my-window'))
      expect(onWaitingWindowSelect).toHaveBeenCalledWith(entry)
    })
  })
})
