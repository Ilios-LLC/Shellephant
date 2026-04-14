import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewWindowWizard from '../../src/renderer/src/components/NewWindowWizard.svelte'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 7,
  name: 'alpha',
  git_url: 'git@github.com:org/alpha.git',
  created_at: '2026-01-01T00:00:00Z'
}

const createdWindow: WindowRecord = {
  id: 99,
  name: 'dev-window',
  project_id: 7,
  container_id: 'container-xyz',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running'
}

describe('NewWindowWizard', () => {
  let mockCreateWindow: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCreateWindow = vi.fn().mockResolvedValue(createdWindow)
    vi.stubGlobal('api', {
      createWindow: mockCreateWindow,
      onWindowCreateProgress: vi.fn(),
      offWindowCreateProgress: vi.fn()
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('displays the project name in the subtitle', () => {
    render(NewWindowWizard, { project, onCreated: vi.fn(), onCancel: vi.fn() })
    expect(screen.getByText('alpha')).toBeDefined()
  })

  it('calls api.createWindow with name and projectId, then fires onCreated', async () => {
    const onCreated = vi.fn()
    render(NewWindowWizard, { project, onCreated, onCancel: vi.fn() })

    await fireEvent.input(screen.getByPlaceholderText('dev-window'), {
      target: { value: 'dev-window' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))

    await waitFor(() => {
      expect(mockCreateWindow).toHaveBeenCalledWith('dev-window', 7)
      expect(onCreated).toHaveBeenCalledWith(createdWindow)
    })
  })

  it('clicking cancel invokes onCancel', async () => {
    const onCancel = vi.fn()
    render(NewWindowWizard, { project, onCreated: vi.fn(), onCancel })
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows error message when createWindow rejects', async () => {
    mockCreateWindow.mockRejectedValueOnce(new Error('docker unavailable'))
    render(NewWindowWizard, { project, onCreated: vi.fn(), onCancel: vi.fn() })

    await fireEvent.input(screen.getByPlaceholderText('dev-window'), {
      target: { value: 'dev-window' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))

    await waitFor(() => {
      expect(screen.getByText(/docker unavailable/i)).toBeDefined()
    })
  })
})
