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
  let mockCreateWindow: ReturnType<typeof vi.fn>
  let mockDeleteProject: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCreateWindow = vi.fn().mockResolvedValue(mockWindow)
    mockDeleteProject = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      createWindow: mockCreateWindow,
      deleteProject: mockDeleteProject
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
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    expect(screen.getByText('my-project')).toBeDefined()
    expect(screen.getByText('git@github.com:org/my-project.git')).toBeDefined()
  })

  it('lists windows belonging to the project', () => {
    render(ProjectView, {
      project,
      windows: [mockWindow],
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    expect(screen.getByText('dev-window')).toBeDefined()
  })

  it('shows empty state when no windows', () => {
    render(ProjectView, {
      project,
      windows: [],
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    expect(screen.getByText(/no windows/i)).toBeDefined()
  })

  it('creates window with project id on form submit', async () => {
    render(ProjectView, {
      project,
      windows: [],
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })

    const input = screen.getByPlaceholderText('window name')
    const button = screen.getByRole('button', { name: /create window/i })

    await fireEvent.input(input, { target: { value: 'new-win' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(mockCreateWindow).toHaveBeenCalledWith('new-win', 1)
    })
  })

  it('calls onWindowSelect when a window is clicked', async () => {
    const onWindowSelect = vi.fn()
    render(ProjectView, {
      project,
      windows: [mockWindow],
      onWindowSelect,
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    await fireEvent.click(screen.getByText('dev-window'))
    expect(onWindowSelect).toHaveBeenCalledWith(mockWindow)
  })
})
