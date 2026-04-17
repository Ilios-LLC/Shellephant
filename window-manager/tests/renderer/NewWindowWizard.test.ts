import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewWindowWizard from '../../src/renderer/src/components/NewWindowWizard.svelte'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1, name: 'my-project', git_url: 'https://github.com/x/y', created_at: ''
}

const mockWindow: WindowRecord = {
  id: 10, name: 'dev', project_id: 1, container_id: 'abc', created_at: '', status: 'running', projects: []
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
    await waitFor(() => expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1], false))
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
    await waitFor(() => expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1], true))
  })
})

describe('multi-project mode', () => {
  const p1: ProjectRecord = { id: 1, name: 'project-one', git_url: 'https://github.com/x/a', created_at: '' }
  const p2: ProjectRecord = { id: 2, name: 'project-two', git_url: 'https://github.com/x/b', created_at: '' }
  const p3: ProjectRecord = { id: 3, name: 'project-three', git_url: 'https://github.com/x/c', created_at: '' }

  function multiProps(overrides = {}) {
    return { projects: [p1, p2, p3], onCreated: vi.fn(), onCancel: vi.fn(), ...overrides }
  }

  it('renders checkboxes for each project, all checked by default', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes).toHaveLength(3)
      checkboxes.forEach(cb => expect((cb as HTMLInputElement).checked).toBe(true))
    })
  })

  it('unchecking a project removes it from selection', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('checkbox'))
    const checkboxes = screen.getAllByRole('checkbox')
    // Uncheck project-two (index 1)
    await fireEvent.click(checkboxes[1])
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('mywin', expect.not.arrayContaining([2]), false)
    )
  })

  it('Create button is disabled when no projects are selected', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('checkbox'))
    const checkboxes = screen.getAllByRole('checkbox')
    // Uncheck all
    for (const cb of checkboxes) {
      await fireEvent.click(cb)
    }
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    const createBtn = screen.getByRole('button', { name: /create window/i })
    expect((createBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls createWindow with selectedProjectIds when Create is clicked', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('checkbox'))
    const checkboxes = screen.getAllByRole('checkbox')
    // Uncheck project-three (index 2), leaving p1 and p2
    await fireEvent.click(checkboxes[2])
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'multi-win' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('multi-win', [1, 2], false)
    )
  })
})
