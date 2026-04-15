import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewProjectWizard from '../../src/renderer/src/components/NewProjectWizard.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'

const created: ProjectRecord = {
  id: 42,
  name: 'alpha',
  git_url: 'git@github.com:org/alpha.git',
  created_at: '2026-01-01T00:00:00Z'
}

describe('NewProjectWizard', () => {
  let mockCreateProject: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCreateProject = vi.fn().mockResolvedValue(created)
    vi.stubGlobal('api', { createProject: mockCreateProject })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('submit is disabled until a git url is entered', async () => {
    render(NewProjectWizard, { onCreated: vi.fn(), onCancel: vi.fn() })
    const button = screen.getByRole('button', { name: /create project/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    const urlInput = screen.getByPlaceholderText(/git@github/i)
    await fireEvent.input(urlInput, { target: { value: 'git@github.com:org/repo.git' } })
    expect(button.disabled).toBe(false)
  })

  it('calls api.createProject with name and git url, then fires onCreated', async () => {
    const onCreated = vi.fn()
    render(NewProjectWizard, { onCreated, onCancel: vi.fn() })

    await fireEvent.input(screen.getByPlaceholderText(/git@github/i), {
      target: { value: 'git@github.com:org/alpha.git' }
    })
    await fireEvent.input(screen.getByPlaceholderText('my-project'), {
      target: { value: 'alpha' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /create project/i }))

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith('alpha', 'git@github.com:org/alpha.git', undefined)
      expect(onCreated).toHaveBeenCalledWith(created)
    })
  })

  it('clicking cancel invokes onCancel', async () => {
    const onCancel = vi.fn()
    render(NewProjectWizard, { onCreated: vi.fn(), onCancel })
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('Escape key invokes onCancel', async () => {
    const onCancel = vi.fn()
    render(NewProjectWizard, { onCreated: vi.fn(), onCancel })
    await fireEvent.keyDown(screen.getByPlaceholderText(/git@github/i), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows error message when createProject rejects', async () => {
    mockCreateProject.mockRejectedValueOnce(new Error('clone failed'))
    render(NewProjectWizard, { onCreated: vi.fn(), onCancel: vi.fn() })

    await fireEvent.input(screen.getByPlaceholderText(/git@github/i), {
      target: { value: 'git@github.com:org/alpha.git' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /create project/i }))

    await waitFor(() => {
      expect(screen.getByText(/clone failed/i)).toBeDefined()
    })
  })

  it('renders a ports input field', () => {
    render(NewProjectWizard, { onCreated: vi.fn(), onCancel: vi.fn() })
    expect(screen.getByPlaceholderText('3000, 8080')).toBeInTheDocument()
  })

  it('passes parsed ports to createProject when ports field is filled', async () => {
    const onCreated = vi.fn()
    render(NewProjectWizard, { onCreated, onCancel: vi.fn() })

    await fireEvent.input(screen.getByPlaceholderText(/git@github/i), {
      target: { value: 'git@github.com:org/alpha.git' }
    })
    await fireEvent.input(screen.getByPlaceholderText('3000, 8080'), {
      target: { value: '3000, 8080' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /create project/i }))

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith(
        '',
        'git@github.com:org/alpha.git',
        [3000, 8080]
      )
    })
  })

  it('passes undefined ports when ports field is empty', async () => {
    render(NewProjectWizard, { onCreated: vi.fn(), onCancel: vi.fn() })

    await fireEvent.input(screen.getByPlaceholderText(/git@github/i), {
      target: { value: 'git@github.com:org/alpha.git' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /create project/i }))

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith(
        '',
        'git@github.com:org/alpha.git',
        undefined
      )
    })
  })

  it('shows error when ports field contains non-numeric value', async () => {
    render(NewProjectWizard, { onCreated: vi.fn(), onCancel: vi.fn() })

    await fireEvent.input(screen.getByPlaceholderText(/git@github/i), {
      target: { value: 'git@github.com:org/alpha.git' }
    })
    await fireEvent.input(screen.getByPlaceholderText('3000, 8080'), {
      target: { value: '3000, abc' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /create project/i }))

    await waitFor(() => {
      expect(screen.getByText(/ports must be comma-separated numbers/i)).toBeInTheDocument()
      expect(mockCreateProject).not.toHaveBeenCalled()
    })
  })

  it('shows error when port token has trailing non-numeric characters', async () => {
    render(NewProjectWizard, { onCreated: vi.fn(), onCancel: vi.fn() })

    await fireEvent.input(screen.getByPlaceholderText(/git@github/i), {
      target: { value: 'git@github.com:org/alpha.git' }
    })
    await fireEvent.input(screen.getByPlaceholderText('3000, 8080'), {
      target: { value: '3000abc' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /create project/i }))

    await waitFor(() => {
      expect(screen.getByText(/ports must be comma-separated numbers/i)).toBeInTheDocument()
      expect(mockCreateProject).not.toHaveBeenCalled()
    })
  })
})
