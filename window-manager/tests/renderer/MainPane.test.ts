import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MainPane from '../../src/renderer/src/components/MainPane.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1,
  name: 'test',
  git_url: 'git@github.com:org/test.git',
  created_at: '2026-01-01'
}

describe('MainPane', () => {
  afterEach(() => cleanup())

  it('renders EmptyState when no project selected', () => {
    render(MainPane, {
      project: null,
      windows: [],
      selectedWindow: null,
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    expect(screen.getByText(/no project selected/i)).toBeDefined()
  })

  it('renders ProjectView when project selected but no window', () => {
    vi.stubGlobal('api', { createWindow: vi.fn(), deleteProject: vi.fn() })
    render(MainPane, {
      project,
      windows: [],
      selectedWindow: null,
      onWindowSelect: vi.fn(),
      onWindowCreated: vi.fn(),
      onProjectDeleted: vi.fn()
    })
    expect(screen.getByText('test')).toBeDefined()
    vi.unstubAllGlobals()
  })
})
