// tests/renderer/ProjectView.test.ts
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectView from '../../src/renderer/src/components/ProjectView.svelte'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

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

describe('ProjectView', () => {
  let mockDeleteProject: ReturnType<typeof vi.fn>
  let mockDeleteWindow: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockDeleteProject = vi.fn().mockResolvedValue(undefined)
    mockDeleteWindow = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      deleteProject: mockDeleteProject,
      deleteWindow: mockDeleteWindow
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('displays project name and git URL', () => {
    render(ProjectView, {
      project,
      windows: [],
      onWindowSelect: vi.fn(),
      onRequestNewWindow: vi.fn(),
      onProjectDeleted: vi.fn(),
      onWindowDeleted: vi.fn()
    })
    expect(screen.getByText('my-project')).toBeDefined()
    expect(screen.getByText('git@github.com:org/my-project.git')).toBeDefined()
  })

  it('lists windows belonging to the project', () => {
    render(ProjectView, {
      project,
      windows: [mockWindow],
      onWindowSelect: vi.fn(),
      onRequestNewWindow: vi.fn(),
      onProjectDeleted: vi.fn(),
      onWindowDeleted: vi.fn()
    })
    expect(screen.getByText('dev-window')).toBeDefined()
  })

  it('shows empty state when no windows', () => {
    render(ProjectView, {
      project,
      windows: [],
      onWindowSelect: vi.fn(),
      onRequestNewWindow: vi.fn(),
      onProjectDeleted: vi.fn(),
      onWindowDeleted: vi.fn()
    })
    expect(screen.getByText(/no windows/i)).toBeDefined()
  })

  it('clicking the new-window button calls onRequestNewWindow', async () => {
    const onRequestNewWindow = vi.fn()
    render(ProjectView, {
      project,
      windows: [mockWindow],
      onWindowSelect: vi.fn(),
      onRequestNewWindow,
      onProjectDeleted: vi.fn()
    })
    await fireEvent.click(screen.getByRole('button', { name: /new window/i }))
    expect(onRequestNewWindow).toHaveBeenCalled()
  })

  it('clicking the empty-state CTA calls onRequestNewWindow', async () => {
    const onRequestNewWindow = vi.fn()
    render(ProjectView, {
      project,
      windows: [],
      onWindowSelect: vi.fn(),
      onRequestNewWindow,
      onProjectDeleted: vi.fn()
    })
    await fireEvent.click(screen.getByRole('button', { name: /create your first window/i }))
    expect(onRequestNewWindow).toHaveBeenCalled()
  })

  it('calls onWindowSelect when a window is clicked', async () => {
    const onWindowSelect = vi.fn()
    render(ProjectView, {
      project,
      windows: [mockWindow],
      onWindowSelect,
      onRequestNewWindow: vi.fn(),
      onProjectDeleted: vi.fn(),
      onWindowDeleted: vi.fn()
    })
    await fireEvent.click(screen.getByText('dev-window'))
    expect(onWindowSelect).toHaveBeenCalledWith(mockWindow)
  })

  it('two-click delete: first click arms, second click calls api.deleteWindow and onWindowDeleted', async () => {
    const onWindowDeleted = vi.fn()
    render(ProjectView, {
      project,
      windows: [mockWindow],
      onWindowSelect: vi.fn(),
      onRequestNewWindow: vi.fn(),
      onProjectDeleted: vi.fn(),
      onWindowDeleted
    })

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
})
