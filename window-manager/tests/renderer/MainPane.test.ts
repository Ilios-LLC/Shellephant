import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/renderer/src/components/EditorPane.svelte', () => ({
  default: vi.fn(() => ({}))
}))

import MainPane from '../../src/renderer/src/components/MainPane.svelte'
import type { ProjectRecord, TokenStatus } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1,
  name: 'test',
  git_url: 'git@github.com:org/test.git',
  created_at: '2026-01-01'
}

const unconfigured: TokenStatus = { configured: false, hint: null }
const configured: TokenStatus = { configured: true, hint: 'abcd' }

function baseProps(overrides = {}) {
  return {
    project: null as ProjectRecord | null,
    projects: [] as ProjectRecord[],
    windows: [],
    allWindows: [],
    selectedWindow: null,
    view: 'default' as const,
    patStatus: configured,
    claudeStatus: configured,
    settingsRequiredFor: null,
    onWindowSelect: vi.fn(),
    onRequestNewProject: vi.fn(),
    onRequestNewWindow: vi.fn(),
    onProjectCreated: vi.fn(),
    onWindowCreated: vi.fn(),
    onProjectDeleted: vi.fn(),
    onWindowDeleted: vi.fn(),
    onPatStatusChange: vi.fn(),
    onClaudeStatusChange: vi.fn(),
    onWizardCancel: vi.fn(),
    onNavigateToWindow: vi.fn(),
    ...overrides
  }
}

describe('MainPane', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders EmptyState when no project selected', () => {
    const { container } = render(MainPane, baseProps())
    // EmptyState is identified by its logo SVG (no headings/copy left to assert).
    expect(container.querySelector('svg.logo')).not.toBeNull()
  })

  it('renders ProjectView when project selected but no window', () => {
    vi.stubGlobal('api', { createWindow: vi.fn(), deleteProject: vi.fn() })
    render(MainPane, baseProps({ project }))
    expect(screen.getByText('test')).toBeDefined()
  })

  it('renders NewProjectWizard when view=new-project', () => {
    vi.stubGlobal('api', { createProject: vi.fn() })
    render(MainPane, baseProps({ view: 'new-project' }))
    expect(screen.getByRole('heading', { name: /new project/i })).toBeDefined()
    expect(screen.getByPlaceholderText(/git@github/i)).toBeDefined()
  })

  it('renders NewWindowWizard when view=new-window and project present', () => {
    vi.stubGlobal('api', { createWindow: vi.fn() })
    render(MainPane, baseProps({ project, view: 'new-window' }))
    expect(screen.getByRole('heading', { name: /new window/i })).toBeDefined()
    expect(screen.getByPlaceholderText(/dev-window/i)).toBeDefined()
  })

  it('renders SettingsView when view=settings', () => {
    vi.stubGlobal('api', {
      setGitHubPat: vi.fn(),
      clearGitHubPat: vi.fn(),
      setClaudeToken: vi.fn(),
      clearClaudeToken: vi.fn()
    })
    render(
      MainPane,
      baseProps({ view: 'settings', patStatus: unconfigured, claudeStatus: unconfigured })
    )
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeDefined()
    expect(screen.getByLabelText(/github personal access token/i)).toBeDefined()
    expect(screen.getByLabelText(/claude code oauth token/i)).toBeDefined()
  })

  it('shows project-required banner when settingsRequiredFor=project', () => {
    vi.stubGlobal('api', {
      setGitHubPat: vi.fn(),
      clearGitHubPat: vi.fn(),
      setClaudeToken: vi.fn(),
      clearClaudeToken: vi.fn()
    })
    render(
      MainPane,
      baseProps({
        view: 'settings',
        patStatus: unconfigured,
        claudeStatus: unconfigured,
        settingsRequiredFor: 'project'
      })
    )
    expect(screen.getByText(/required before you can create a project/i)).toBeDefined()
  })

  it('shows window-required banner when settingsRequiredFor=window', () => {
    vi.stubGlobal('api', {
      setGitHubPat: vi.fn(),
      clearGitHubPat: vi.fn(),
      setClaudeToken: vi.fn(),
      clearClaudeToken: vi.fn()
    })
    render(
      MainPane,
      baseProps({
        view: 'settings',
        patStatus: configured,
        claudeStatus: unconfigured,
        settingsRequiredFor: 'window'
      })
    )
    expect(screen.getByText(/required before you can create a window/i)).toBeDefined()
  })
})
