// tests/renderer/CreateProject.test.ts
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CreateProject from '../../src/renderer/src/components/CreateProject.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'

const mockProject: ProjectRecord = {
  id: 1,
  name: 'my-repo',
  git_url: 'git@github.com:org/my-repo.git',
  created_at: '2026-01-01T00:00:00Z'
}

describe('CreateProject', () => {
  let mockCreateProject: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCreateProject = vi.fn().mockResolvedValue(mockProject)
    vi.stubGlobal('api', { createProject: mockCreateProject })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders SSH URL input with placeholder when expanded', () => {
    render(CreateProject, { startExpanded: true })
    expect(screen.getByPlaceholderText('git@github.com:org/repo.git')).toBeDefined()
  })

  it('renders optional name input', () => {
    render(CreateProject, { startExpanded: true })
    expect(screen.getByPlaceholderText('project name (optional)')).toBeDefined()
  })

  it('calls window.api.createProject with URL and name on submit', async () => {
    render(CreateProject, { startExpanded: true })
    const urlInput = screen.getByPlaceholderText('git@github.com:org/repo.git')
    const nameInput = screen.getByPlaceholderText('project name (optional)')
    const button = screen.getByRole('button', { name: /add project/i })

    await fireEvent.input(urlInput, { target: { value: 'git@github.com:org/my-repo.git' } })
    await fireEvent.input(nameInput, { target: { value: 'My Project' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith('My Project', 'git@github.com:org/my-repo.git')
    })
  })

  it('calls onCreated callback with new project record', async () => {
    const onCreated = vi.fn()
    render(CreateProject, { startExpanded: true, onCreated })
    const urlInput = screen.getByPlaceholderText('git@github.com:org/repo.git')
    const button = screen.getByRole('button', { name: /add project/i })

    await fireEvent.input(urlInput, { target: { value: 'git@github.com:org/my-repo.git' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(mockProject)
    })
  })

  it('disables button when URL is empty', async () => {
    render(CreateProject, { startExpanded: true })
    const button = screen.getByRole('button', { name: /add project/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows error message if API call fails', async () => {
    mockCreateProject.mockRejectedValue(new Error('Invalid SSH URL'))
    render(CreateProject, { startExpanded: true })
    const urlInput = screen.getByPlaceholderText('git@github.com:org/repo.git')
    const button = screen.getByRole('button', { name: /add project/i })

    await fireEvent.input(urlInput, { target: { value: 'bad-url' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Invalid SSH URL')).toBeDefined()
    })
  })

  it('starts collapsed by default and shows + button', () => {
    render(CreateProject, {})
    expect(screen.getByRole('button', { name: /new project/i })).toBeDefined()
  })

  it('pressing Escape collapses the form', async () => {
    render(CreateProject, { startExpanded: true })
    const input = screen.getByPlaceholderText('git@github.com:org/repo.git')
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /new project/i })).toBeDefined()
  })
})
