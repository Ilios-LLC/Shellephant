import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewWindowWizard from '../../src/renderer/src/components/NewWindowWizard.svelte'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1, name: 'my-project', git_url: 'https://github.com/x/y', created_at: ''
}

const mockWindow: WindowRecord = {
  id: 10, name: 'dev', project_id: 1, container_id: 'abc', created_at: '', status: 'running'
}

function baseProps(overrides = {}) {
  return { project, onCreated: vi.fn(), onCancel: vi.fn(), ...overrides }
}

let mockListDeps: ReturnType<typeof vi.fn>
let mockCreateWindow: ReturnType<typeof vi.fn>
let mockOnProgress: ReturnType<typeof vi.fn>
let mockOffProgress: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockListDeps = vi.fn().mockResolvedValue([])
  mockCreateWindow = vi.fn().mockResolvedValue(mockWindow)
  mockOnProgress = vi.fn()
  mockOffProgress = vi.fn()
  vi.stubGlobal('api', {
    listDependencies: mockListDeps,
    createWindow: mockCreateWindow,
    onWindowCreateProgress: mockOnProgress,
    offWindowCreateProgress: mockOffProgress
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NewWindowWizard', () => {
  it('does not show deps toggle when project has no dependencies', async () => {
    mockListDeps.mockResolvedValue([])
    render(NewWindowWizard, baseProps())
    await waitFor(() => expect(mockListDeps).toHaveBeenCalledWith(1))
    expect(screen.queryByRole('checkbox', { name: /start with dependencies/i })).toBeNull()
  })

  it('shows deps toggle when project has dependencies', async () => {
    mockListDeps.mockResolvedValue([
      { id: 1, project_id: 1, image: 'redis', tag: 'latest', env_vars: null, created_at: '' }
    ])
    render(NewWindowWizard, baseProps())
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /start with dependencies/i })).toBeDefined()
    )
  })

  it('calls createWindow with withDeps=false when toggle unchecked', async () => {
    mockListDeps.mockResolvedValue([
      { id: 1, project_id: 1, image: 'redis', tag: 'latest', env_vars: null, created_at: '' }
    ])
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('checkbox', { name: /start with dependencies/i }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() => expect(mockCreateWindow).toHaveBeenCalledWith('mywin', 1, false))
  })

  it('calls createWindow with withDeps=true when toggle is checked', async () => {
    mockListDeps.mockResolvedValue([
      { id: 1, project_id: 1, image: 'redis', tag: 'latest', env_vars: null, created_at: '' }
    ])
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('checkbox', { name: /start with dependencies/i }))
    await fireEvent.click(screen.getByRole('checkbox', { name: /start with dependencies/i }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() => expect(mockCreateWindow).toHaveBeenCalledWith('mywin', 1, true))
  })
})
