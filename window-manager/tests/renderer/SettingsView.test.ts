import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsView from '../../src/renderer/src/components/SettingsView.svelte'
import type { TokenStatus } from '../../src/renderer/src/types'

const unconfigured: TokenStatus = { configured: false, hint: null }
const patConfigured: TokenStatus = { configured: true, hint: 'efgh' }
const claudeConfigured: TokenStatus = { configured: true, hint: '4567' }

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    patStatus: unconfigured,
    claudeStatus: unconfigured,
    requiredFor: null,
    onPatStatusChange: vi.fn(),
    onClaudeStatusChange: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  }
}

describe('SettingsView', () => {
  let mockSetPat: ReturnType<typeof vi.fn>
  let mockClearPat: ReturnType<typeof vi.fn>
  let mockSetClaude: ReturnType<typeof vi.fn>
  let mockClearClaude: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSetPat = vi.fn().mockResolvedValue(patConfigured)
    mockClearPat = vi.fn().mockResolvedValue(unconfigured)
    mockSetClaude = vi.fn().mockResolvedValue(claudeConfigured)
    mockClearClaude = vi.fn().mockResolvedValue(unconfigured)
    vi.stubGlobal('api', {
      setGitHubPat: mockSetPat,
      clearGitHubPat: mockClearPat,
      setClaudeToken: mockSetClaude,
      clearClaudeToken: mockClearClaude
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders both token fields', () => {
    render(SettingsView, baseProps())
    expect(screen.getByLabelText(/github personal access token/i)).toBeDefined()
    expect(screen.getByLabelText(/claude code oauth token/i)).toBeDefined()
  })

  it('shows each token status independently', () => {
    render(
      SettingsView,
      baseProps({ patStatus: patConfigured, claudeStatus: unconfigured })
    )
    expect(screen.getByText(/ends in efgh/i)).toBeDefined()
    expect(screen.getByText(/not configured/i)).toBeDefined()
  })

  it('banner shows project-required when requiredFor=project', () => {
    render(SettingsView, baseProps({ requiredFor: 'project' }))
    expect(screen.getByText(/required before you can create a project/i)).toBeDefined()
  })

  it('banner shows window-required when requiredFor=window', () => {
    render(SettingsView, baseProps({ requiredFor: 'window' }))
    expect(screen.getByText(/required before you can create a window/i)).toBeDefined()
  })

  it('saving PAT calls api.setGitHubPat and fires onPatStatusChange', async () => {
    const onPatStatusChange = vi.fn()
    render(SettingsView, baseProps({ onPatStatusChange }))

    await fireEvent.input(screen.getByLabelText(/github personal access token/i), {
      target: { value: 'ghp_token' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /save pat/i }))

    await waitFor(() => {
      expect(mockSetPat).toHaveBeenCalledWith('ghp_token')
      expect(onPatStatusChange).toHaveBeenCalledWith(patConfigured)
    })
  })

  it('saving Claude token calls api.setClaudeToken and fires onClaudeStatusChange', async () => {
    const onClaudeStatusChange = vi.fn()
    render(SettingsView, baseProps({ onClaudeStatusChange }))

    await fireEvent.input(screen.getByLabelText(/claude code oauth token/i), {
      target: { value: 'sk-ant-xxx' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /save token/i }))

    await waitFor(() => {
      expect(mockSetClaude).toHaveBeenCalledWith('sk-ant-xxx')
      expect(onClaudeStatusChange).toHaveBeenCalledWith(claudeConfigured)
    })
  })

  it('Clear button only shows for configured tokens', () => {
    render(
      SettingsView,
      baseProps({ patStatus: patConfigured, claudeStatus: unconfigured })
    )
    const clearButtons = screen.getAllByRole('button', { name: /^clear$/i })
    // Only one Clear button (PAT); Claude section has no Clear since unconfigured
    expect(clearButtons).toHaveLength(1)
  })

  it('clearing PAT calls api.clearGitHubPat', async () => {
    const onPatStatusChange = vi.fn()
    render(
      SettingsView,
      baseProps({ patStatus: patConfigured, onPatStatusChange })
    )

    await fireEvent.click(screen.getByRole('button', { name: /^clear$/i }))

    await waitFor(() => {
      expect(mockClearPat).toHaveBeenCalled()
      expect(onPatStatusChange).toHaveBeenCalledWith(unconfigured)
    })
  })

  it('clearing Claude token calls api.clearClaudeToken', async () => {
    const onClaudeStatusChange = vi.fn()
    render(
      SettingsView,
      baseProps({ claudeStatus: claudeConfigured, onClaudeStatusChange })
    )

    await fireEvent.click(screen.getByRole('button', { name: /^clear$/i }))

    await waitFor(() => {
      expect(mockClearClaude).toHaveBeenCalled()
      expect(onClaudeStatusChange).toHaveBeenCalledWith(unconfigured)
    })
  })

  it('Close invokes onCancel', async () => {
    const onCancel = vi.fn()
    render(SettingsView, baseProps({ onCancel }))
    await fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows an inline error when setGitHubPat rejects', async () => {
    mockSetPat.mockRejectedValueOnce(new Error('secure storage unavailable'))
    render(SettingsView, baseProps())

    await fireEvent.input(screen.getByLabelText(/github personal access token/i), {
      target: { value: 'ghp_token' }
    })
    await fireEvent.click(screen.getByRole('button', { name: /save pat/i }))

    await waitFor(() => {
      expect(screen.getByText(/secure storage unavailable/i)).toBeDefined()
    })
  })
})
