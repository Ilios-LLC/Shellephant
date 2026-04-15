// tests/renderer/ProjectView.test.ts
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectView from '../../src/renderer/src/components/ProjectView.svelte'
import type { ProjectRecord, ProjectGroupRecord, WindowRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1,
  name: 'my-project',
  git_url: 'git@github.com:org/my-project.git',
  created_at: '2026-01-01T00:00:00Z'
}

const mockWindow: WindowRecord = {
  id: 10,
  name: 'dev-window',
  project_id: 1,
  container_id: 'container-abc',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running'
}

function makeGroup(id: number, name: string): ProjectGroupRecord {
  return { id, name, created_at: '2026-01-01T00:00:00Z' }
}

function baseProjectViewProps(overrides: Record<string, unknown> = {}) {
  return {
    project,
    windows: [],
    groups: [] as ProjectGroupRecord[],
    onWindowSelect: vi.fn(),
    onRequestNewWindow: vi.fn(),
    onProjectDeleted: vi.fn(),
    onWindowDeleted: vi.fn(),
    onProjectUpdated: vi.fn(),
    ...overrides
  }
}

describe('ProjectView', () => {
  let mockDeleteProject: ReturnType<typeof vi.fn>
  let mockDeleteWindow: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockDeleteProject = vi.fn().mockResolvedValue(undefined)
    mockDeleteWindow = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      deleteProject: mockDeleteProject,
      deleteWindow: mockDeleteWindow,
      updateProject: vi.fn().mockResolvedValue({ ...project, group_id: null })
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('displays project name and git URL', () => {
    render(ProjectView, baseProjectViewProps())
    expect(screen.getByText('my-project')).toBeDefined()
    expect(screen.getByText('git@github.com:org/my-project.git')).toBeDefined()
  })

  it('lists windows belonging to the project', () => {
    render(ProjectView, baseProjectViewProps({ windows: [mockWindow] }))
    expect(screen.getByText('dev-window')).toBeDefined()
  })

  it('shows empty state when no windows', () => {
    render(ProjectView, baseProjectViewProps())
    expect(screen.getByText(/no windows/i)).toBeDefined()
  })

  it('clicking the new-window button calls onRequestNewWindow', async () => {
    const onRequestNewWindow = vi.fn()
    render(ProjectView, baseProjectViewProps({ windows: [mockWindow], onRequestNewWindow }))
    await fireEvent.click(screen.getByRole('button', { name: /new window/i }))
    expect(onRequestNewWindow).toHaveBeenCalled()
  })

  it('clicking the empty-state CTA calls onRequestNewWindow', async () => {
    const onRequestNewWindow = vi.fn()
    render(ProjectView, baseProjectViewProps({ onRequestNewWindow }))
    await fireEvent.click(screen.getByRole('button', { name: /create your first window/i }))
    expect(onRequestNewWindow).toHaveBeenCalled()
  })

  it('calls onWindowSelect when a window is clicked', async () => {
    const onWindowSelect = vi.fn()
    render(ProjectView, baseProjectViewProps({ windows: [mockWindow], onWindowSelect }))
    await fireEvent.click(screen.getByText('dev-window'))
    expect(onWindowSelect).toHaveBeenCalledWith(mockWindow)
  })

  it('two-click delete: first click arms, second click calls api.deleteWindow and onWindowDeleted', async () => {
    const onWindowDeleted = vi.fn()
    render(ProjectView, baseProjectViewProps({ windows: [mockWindow], onWindowDeleted }))

    const deleteBtn = screen.getByRole('button', { name: /delete dev-window/i })
    await fireEvent.click(deleteBtn)
    expect(mockDeleteWindow).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm delete dev-window/i })).toBeDefined()

    await fireEvent.click(screen.getByRole('button', { name: /confirm delete dev-window/i }))
    await waitFor(() => {
      expect(mockDeleteWindow).toHaveBeenCalledWith(mockWindow.id)
      expect(onWindowDeleted).toHaveBeenCalledWith(mockWindow.id)
    })
  })

  describe('group assignment', () => {
    it('shows a group select with "No group" option when no groups exist', () => {
      render(ProjectView, baseProjectViewProps())
      expect(screen.getByRole('combobox', { name: /group/i })).toBeDefined()
      expect(screen.getByText('No group')).toBeDefined()
    })

    it('renders group names as options', () => {
      render(ProjectView, baseProjectViewProps({
        groups: [makeGroup(1, 'Frontend'), makeGroup(2, 'Backend')]
      }))
      expect(screen.getByText('Frontend')).toBeDefined()
      expect(screen.getByText('Backend')).toBeDefined()
    })

    it('changing the group select calls api.updateProject', async () => {
      const mockUpdate = vi.fn().mockResolvedValue({ ...project, group_id: 1 })
      vi.stubGlobal('api', {
        deleteProject: vi.fn(),
        deleteWindow: vi.fn(),
        updateProject: mockUpdate
      })
      render(ProjectView, baseProjectViewProps({
        groups: [makeGroup(1, 'Frontend')]
      }))
      const select = screen.getByRole('combobox', { name: /group/i })
      await fireEvent.change(select, { target: { value: '1' } })
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(project.id, { groupId: 1 })
      })
    })

    it('changing to "No group" calls api.updateProject with null', async () => {
      const mockUpdate = vi.fn().mockResolvedValue({ ...project, group_id: null })
      vi.stubGlobal('api', {
        deleteProject: vi.fn(),
        deleteWindow: vi.fn(),
        updateProject: mockUpdate
      })
      const projectWithGroup = { ...project, group_id: 1 }
      render(ProjectView, baseProjectViewProps({
        project: projectWithGroup,
        groups: [makeGroup(1, 'Frontend')]
      }))
      const select = screen.getByRole('combobox', { name: /group/i })
      await fireEvent.change(select, { target: { value: '' } })
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(project.id, { groupId: null })
      })
    })
  })
})
