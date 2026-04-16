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
  let mockUpdateDependency: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockListDependencies = vi.fn().mockResolvedValue([])
    mockCreateDependency = vi.fn().mockResolvedValue(mockDep)
    mockDeleteDependency = vi.fn().mockResolvedValue(undefined)
    mockUpdateDependency = vi.fn().mockResolvedValue(mockDep)
    vi.stubGlobal('api', {
      listDependencies: mockListDependencies,
      createDependency: mockCreateDependency,
      deleteDependency: mockDeleteDependency,
      updateDependency: mockUpdateDependency
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

  describe('add form env vars', () => {
    async function openForm() {
      mountSection()
      await waitFor(() => screen.getByRole('button', { name: /add dependency/i }))
      await fireEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    }

    it('shows Add Env Var button in add form', async () => {
      await openForm()
      expect(screen.getByRole('button', { name: /add env var/i })).toBeDefined()
    })

    it('clicking Add Env Var renders KEY and VALUE inputs', async () => {
      await openForm()
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      expect(screen.getByPlaceholderText(/^KEY$/i)).toBeDefined()
      expect(screen.getByPlaceholderText(/^VALUE$/i)).toBeDefined()
    })

    it('clicking × removes the env var row', async () => {
      await openForm()
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      expect(screen.getByPlaceholderText(/^KEY$/i)).toBeDefined()
      await fireEvent.click(screen.getByRole('button', { name: /remove env var/i }))
      expect(screen.queryByPlaceholderText(/^KEY$/i)).toBeNull()
    })

    it('passes env vars to createDependency on save', async () => {
      mockListDependencies.mockResolvedValueOnce([]).mockResolvedValueOnce([mockDep])
      await openForm()
      await fireEvent.input(screen.getByPlaceholderText(/postgres/i), { target: { value: 'postgres' } })
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      await fireEvent.input(screen.getByPlaceholderText(/^KEY$/i), { target: { value: 'DB_PASS' } })
      await fireEvent.input(screen.getByPlaceholderText(/^VALUE$/i), { target: { value: 'secret' } })
      await fireEvent.click(screen.getByRole('button', { name: /save dependency/i }))
      await waitFor(() => {
        expect(mockCreateDependency).toHaveBeenCalledWith(1, 'postgres', 'latest', { DB_PASS: 'secret' })
      })
    })

    it('skips rows with blank KEY on save', async () => {
      mockListDependencies.mockResolvedValueOnce([]).mockResolvedValueOnce([mockDep])
      await openForm()
      await fireEvent.input(screen.getByPlaceholderText(/postgres/i), { target: { value: 'postgres' } })
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      // leave KEY blank, fill VALUE
      await fireEvent.input(screen.getByPlaceholderText(/^VALUE$/i), { target: { value: 'ignored' } })
      await fireEvent.click(screen.getByRole('button', { name: /save dependency/i }))
      await waitFor(() => {
        expect(mockCreateDependency).toHaveBeenCalledWith(1, 'postgres', 'latest', {})
      })
    })

    it('cancel clears env var rows so reopening shows empty form', async () => {
      await openForm()
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      expect(screen.getByPlaceholderText(/^KEY$/i)).toBeDefined()
      await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      // Reopen
      await fireEvent.click(screen.getByRole('button', { name: /add dependency/i }))
      expect(screen.queryByPlaceholderText(/^KEY$/i)).toBeNull()
    })
  })

  describe('inline env var edit', () => {
    const depWithEnv = {
      id: 2,
      project_id: 1,
      image: 'redis',
      tag: '7',
      env_vars: { REDIS_PASS: 'pw' },
      created_at: ''
    }

    it('shows Edit Env Vars button per dep', async () => {
      mockListDependencies.mockResolvedValue([mockDep])
      mountSection()
      await waitFor(() => screen.getByText('postgres:latest'))
      expect(screen.getByRole('button', { name: /edit env vars/i })).toBeDefined()
    })

    it('expanding edit shows pre-populated KEY and VALUE inputs', async () => {
      mockListDependencies.mockResolvedValue([depWithEnv])
      mountSection()
      await waitFor(() => screen.getByRole('button', { name: /edit env vars/i }))
      await fireEvent.click(screen.getByRole('button', { name: /edit env vars/i }))
      expect((screen.getByPlaceholderText(/^KEY$/i) as HTMLInputElement).value).toBe('REDIS_PASS')
      expect((screen.getByPlaceholderText(/^VALUE$/i) as HTMLInputElement).value).toBe('pw')
    })

    it('save calls updateDependency with new values', async () => {
      mockListDependencies.mockResolvedValue([mockDep])
      mountSection()
      await waitFor(() => screen.getByRole('button', { name: /edit env vars/i }))
      await fireEvent.click(screen.getByRole('button', { name: /edit env vars/i }))
      await fireEvent.click(screen.getByRole('button', { name: /add env var/i }))
      await fireEvent.input(screen.getByPlaceholderText(/^KEY$/i), { target: { value: 'FOO' } })
      await fireEvent.input(screen.getByPlaceholderText(/^VALUE$/i), { target: { value: 'bar' } })
      await fireEvent.click(screen.getByRole('button', { name: /save env vars/i }))
      await waitFor(() => expect(mockUpdateDependency).toHaveBeenCalledWith(1, { FOO: 'bar' }))
    })

    it('cancel collapses editor without calling updateDependency', async () => {
      mockListDependencies.mockResolvedValue([mockDep])
      mountSection()
      await waitFor(() => screen.getByRole('button', { name: /edit env vars/i }))
      await fireEvent.click(screen.getByRole('button', { name: /edit env vars/i }))
      await fireEvent.click(screen.getByRole('button', { name: /cancel env vars/i }))
      expect(mockUpdateDependency).not.toHaveBeenCalled()
      expect(screen.queryByPlaceholderText(/^KEY$/i)).toBeNull()
    })

    it('opening a second edit collapses the first', async () => {
      const dep2 = { ...depWithEnv, id: 3, image: 'mysql', tag: '8' }
      mockListDependencies.mockResolvedValue([depWithEnv, dep2])
      mountSection()
      await waitFor(() => {
        const btns = screen.getAllByRole('button', { name: /edit env vars/i })
        expect(btns).toHaveLength(2)
      })
      const [btn1, btn2] = screen.getAllByRole('button', { name: /edit env vars/i })
      await fireEvent.click(btn1)
      expect(screen.getAllByPlaceholderText(/^KEY$/i)).toHaveLength(1)
      await fireEvent.click(btn2)
      expect(screen.getAllByPlaceholderText(/^KEY$/i)).toHaveLength(1)
    })
  })
})
