import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../../src/renderer/src/components/Sidebar.svelte'
import type { ProjectRecord, ProjectGroupRecord, WindowRecord } from '../../src/renderer/src/types'
import { waitingWindows } from '../../src/renderer/src/lib/waitingWindows'


function makeProject(id: number, name: string): ProjectRecord {
  return {
    id,
    name,
    git_url: `git@github.com:org/${name}.git`,
    created_at: '2026-01-01T00:00:00Z'
  }
}

function makeWindow(id: number, status: 'running' | 'stopped' = 'running'): WindowRecord {
  return {
    id,
    name: `win${id}`,
    project_id: 1,
    container_id: `container-${id}`,
    window_type: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    status,
    projects: [{ id, window_id: id, project_id: 1, clone_path: '/tmp', project_name: 'proj1' }]
  }
}

describe('Sidebar', () => {
  let onProjectSelect: ReturnType<typeof vi.fn>
  let onRequestNewProject: ReturnType<typeof vi.fn>
  let onRequestSettings: ReturnType<typeof vi.fn>
  let onRequestHome: ReturnType<typeof vi.fn>
  let onWindowSelect: ReturnType<typeof vi.fn>
  let onGroupSelect: ReturnType<typeof vi.fn>
  let onGroupCreated: ReturnType<typeof vi.fn>
  let onProjectSettingsClick: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onProjectSelect = vi.fn()
    onRequestNewProject = vi.fn()
    onRequestSettings = vi.fn()
    onRequestHome = vi.fn()
    onWindowSelect = vi.fn()
    onGroupSelect = vi.fn()
    onGroupCreated = vi.fn()
    onProjectSettingsClick = vi.fn()
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
      allWindows: [] as WindowRecord[],
      onProjectSelect,
      onRequestNewProject,
      onRequestSettings,
      onRequestHome,
      onWindowSelect,
      onGroupSelect,
      onGroupCreated,
      onProjectSettingsClick,
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

  it('clicking the gear icon on a project calls onProjectSettingsClick with that project', async () => {
    const p = makeProject(4, 'delta')
    render(Sidebar, baseProps({ projects: [p] }))
    await fireEvent.click(screen.getByRole('button', { name: /project settings/i }))
    expect(onProjectSettingsClick).toHaveBeenCalledWith(p)
  })

  describe('multi-project window button', () => {
    let onRequestMultiWindow: ReturnType<typeof vi.fn>

    beforeEach(() => {
      onRequestMultiWindow = vi.fn()
    })

    it('shows the button when there are 2 or more projects', () => {
      render(Sidebar, baseProps({
        projects: [makeProject(1, 'alpha'), makeProject(2, 'beta')],
        onRequestMultiWindow
      }))
      expect(screen.getByRole('button', { name: /multi-project window/i })).toBeDefined()
    })

    it('hides the button when there is only 1 project', () => {
      render(Sidebar, baseProps({
        projects: [makeProject(1, 'alpha')],
        onRequestMultiWindow
      }))
      expect(screen.queryByRole('button', { name: /multi-project window/i })).toBeNull()
    })

    it('hides the button when there are no projects', () => {
      render(Sidebar, baseProps({ onRequestMultiWindow }))
      expect(screen.queryByRole('button', { name: /multi-project window/i })).toBeNull()
    })

    it('clicking the button calls onRequestMultiWindow', async () => {
      render(Sidebar, baseProps({
        projects: [makeProject(1, 'alpha'), makeProject(2, 'beta')],
        onRequestMultiWindow
      }))
      await fireEvent.click(screen.getByRole('button', { name: /multi-project window/i }))
      expect(onRequestMultiWindow).toHaveBeenCalled()
    })

    it('does not show the button when onRequestMultiWindow is not provided', () => {
      render(Sidebar, baseProps({
        projects: [makeProject(1, 'alpha'), makeProject(2, 'beta')]
      }))
      expect(screen.queryByRole('button', { name: /multi-project window/i })).toBeNull()
    })
  })

  describe('running windows section', () => {
    beforeEach(() => waitingWindows._resetForTest())
    afterEach(() => waitingWindows._resetForTest())

    it('does not render running section when no running windows', () => {
      render(Sidebar, baseProps())
      expect(screen.queryByText(/^running$/i)).toBeNull()
    })

    it('renders running section when running windows exist', () => {
      const w = makeWindow(1)
      render(Sidebar, baseProps({ allWindows: [w] }))
      expect(screen.getByText(/^running$/i)).toBeDefined()
      expect(screen.getByText('proj1 / win1')).toBeDefined()
    })
  })
})
