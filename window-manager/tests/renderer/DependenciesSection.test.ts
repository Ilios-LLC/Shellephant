// tests/renderer/DependenciesSection.test.ts
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import DependenciesSection from '../../src/renderer/src/components/DependenciesSection.svelte'

const mockDep = { id: 1, project_id: 1, image: 'postgres', tag: 'latest', env_vars: null, created_at: '' }

function mountSection(overrides: Record<string, unknown> = {}) {
  return render(DependenciesSection, { projectId: 1, ...overrides })
}

describe('DependenciesSection', () => {
  let mockListDependencies: ReturnType<typeof vi.fn>
  let mockCreateDependency: ReturnType<typeof vi.fn>
  let mockDeleteDependency: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockListDependencies = vi.fn().mockResolvedValue([])
    mockCreateDependency = vi.fn().mockResolvedValue(mockDep)
    mockDeleteDependency = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      listDependencies: mockListDependencies,
      createDependency: mockCreateDependency,
      deleteDependency: mockDeleteDependency
    })
  })

  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('shows empty state when no deps', async () => {
    mountSection()
    await waitFor(() => expect(screen.getByText(/no dependencies/i)).toBeDefined())
  })

  it('lists existing deps', async () => {
    mockListDependencies.mockResolvedValue([mockDep])
    mountSection()
    await waitFor(() => expect(screen.getByText('postgres:latest')).toBeDefined())
  })

  it('shows add form when Add button clicked', async () => {
    mountSection()
    await waitFor(() => screen.getByRole('button', { name: /add dependency/i }))
    await fireEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    expect(screen.getByPlaceholderText(/postgres/i)).toBeDefined()
  })

  it('calls createDependency and reloads on save', async () => {
    mockListDependencies.mockResolvedValueOnce([]).mockResolvedValueOnce([mockDep])
    mountSection()
    await waitFor(() => screen.getByRole('button', { name: /add dependency/i }))
    await fireEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    await fireEvent.input(screen.getByPlaceholderText(/postgres/i), { target: { value: 'postgres' } })
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(mockCreateDependency).toHaveBeenCalledWith(1, 'postgres', 'latest', {})
    })
  })

  it('shows error when createDependency throws', async () => {
    mockListDependencies.mockResolvedValue([])
    mockCreateDependency.mockRejectedValue(new Error('Image not found'))
    mountSection()
    await waitFor(() => screen.getByRole('button', { name: /add dependency/i }))
    await fireEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    await fireEvent.input(screen.getByPlaceholderText(/postgres/i), { target: { value: 'noexist' } })
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText(/image not found/i)).toBeDefined())
  })

  it('two-click delete removes a dep', async () => {
    mockListDependencies.mockResolvedValue([mockDep])
    mountSection()
    await waitFor(() => screen.getByText('postgres:latest'))
    const del = screen.getByRole('button', { name: /delete postgres/i })
    await fireEvent.click(del)
    await fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(mockDeleteDependency).toHaveBeenCalledWith(1))
  })
})
