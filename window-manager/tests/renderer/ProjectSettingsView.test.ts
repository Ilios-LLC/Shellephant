import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSettingsView from '../../src/renderer/src/components/ProjectSettingsView.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1,
  name: 'my-project',
  git_url: 'git@github.com:org/my-project.git',
  created_at: '2026-01-01T00:00:00Z',
  env_vars: null
}

const projectWithVars: ProjectRecord = {
  ...project,
  env_vars: JSON.stringify({ FOO: 'bar', BAZ: 'qux' })
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    project,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  }
}

describe('ProjectSettingsView', () => {
  let mockGetProject: ReturnType<typeof vi.fn>
  let mockUpdateEnvVars: ReturnType<typeof vi.fn>
  let mockUpdatePorts: ReturnType<typeof vi.fn>
  let mockListDockerNetworks: ReturnType<typeof vi.fn>
  let mockUpdateProjectDefaultNetwork: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockGetProject = vi.fn().mockResolvedValue(project)
    mockUpdateEnvVars = vi.fn().mockResolvedValue(undefined)
    mockUpdatePorts = vi.fn().mockResolvedValue(undefined)
    mockListDockerNetworks = vi.fn().mockResolvedValue([
      { id: 'abc', name: 'app-net' },
      { id: 'def', name: 'db-net' }
    ])
    mockUpdateProjectDefaultNetwork = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      getProject: mockGetProject,
      updateProjectEnvVars: mockUpdateEnvVars,
      updateProjectPorts: mockUpdatePorts,
      listDockerNetworks: mockListDockerNetworks,
      updateProjectDefaultNetwork: mockUpdateProjectDefaultNetwork
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the project name in the header', async () => {
    render(ProjectSettingsView, baseProps())
    await waitFor(() => expect(screen.getByText(/my-project/i)).toBeInTheDocument())
  })

  it('renders Environment Variables section heading', async () => {
    render(ProjectSettingsView, baseProps())
    await waitFor(() => expect(screen.getByText(/environment variables/i)).toBeInTheDocument())
  })

  it('loads existing env vars from the project prop', async () => {
    mockGetProject.mockResolvedValue(projectWithVars)
    render(ProjectSettingsView, baseProps({ project: projectWithVars }))
    await waitFor(() => {
      expect(screen.getByDisplayValue('FOO')).toBeDefined()
      expect(screen.getByDisplayValue('bar')).toBeDefined()
    })
  })

  it('Add Variable button appends an empty row', async () => {
    render(ProjectSettingsView, baseProps())
    await waitFor(() => screen.getByRole('button', { name: /add variable/i }))
    await fireEvent.click(screen.getByRole('button', { name: /add variable/i }))
    const keyInputs = screen.getAllByPlaceholderText(/key/i)
    expect(keyInputs.length).toBeGreaterThanOrEqual(1)
  })

  it('remove button deletes a row', async () => {
    mockGetProject.mockResolvedValue(projectWithVars)
    render(ProjectSettingsView, baseProps({ project: projectWithVars }))
    await waitFor(() => screen.getByRole('button', { name: /remove row 1/i }))
    await fireEvent.click(screen.getByRole('button', { name: /remove row 1/i }))
    // FOO row removed, BAZ row remains
    await waitFor(() => {
      expect(screen.queryByDisplayValue('FOO')).toBeNull()
      expect(screen.getByDisplayValue('BAZ')).toBeInTheDocument()
    })
  })

  it('Save calls updateProjectEnvVars with non-empty key rows and fires onSave', async () => {
    const onSave = vi.fn()
    mockGetProject.mockResolvedValue(projectWithVars)
    render(ProjectSettingsView, baseProps({ project: projectWithVars, onSave }))
    await waitFor(() => screen.getByDisplayValue('FOO'))
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(mockUpdateEnvVars).toHaveBeenCalledWith(1, { FOO: 'bar', BAZ: 'qux' })
      expect(onSave).toHaveBeenCalled()
    })
  })

  it('Cancel fires onCancel without saving', async () => {
    const onCancel = vi.fn()
    render(ProjectSettingsView, baseProps({ onCancel }))
    await waitFor(() => screen.getByRole('button', { name: /cancel/i }))
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockUpdateEnvVars).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('rows with empty key are excluded from save', async () => {
    const onSave = vi.fn()
    render(ProjectSettingsView, baseProps({ onSave }))
    await waitFor(() => screen.getByRole('button', { name: /add variable/i }))
    // Add a row but leave key empty
    await fireEvent.click(screen.getByRole('button', { name: /add variable/i }))
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(mockUpdateEnvVars).toHaveBeenCalledWith(1, {})
      expect(onSave).toHaveBeenCalled()
    })
  })

  it('shows an inline error when updateProjectEnvVars rejects', async () => {
    mockGetProject.mockResolvedValue(projectWithVars)
    mockUpdateEnvVars.mockRejectedValueOnce(new Error('network failure'))
    render(ProjectSettingsView, baseProps({ project: projectWithVars }))
    await waitFor(() => screen.getByRole('button', { name: /save/i }))
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(screen.getByText(/network failure/i)).toBeInTheDocument()
    })
  })

  it('renders Port Mappings section heading', async () => {
    render(ProjectSettingsView, baseProps())
    await waitFor(() => expect(screen.getByText(/port mappings/i)).toBeInTheDocument())
  })

  it('loads existing ports from the project record', async () => {
    const projectWithPorts: ProjectRecord = {
      ...project,
      ports: JSON.stringify([{ container: 3000 }, { container: 8080, host: 9000 }])
    }
    mockGetProject.mockResolvedValue(projectWithPorts)
    render(ProjectSettingsView, baseProps({ project: projectWithPorts }))
    await waitFor(() => {
      expect(screen.getByDisplayValue('3000')).toBeDefined()
      expect(screen.getByDisplayValue('8080')).toBeDefined()
      expect(screen.getByDisplayValue('9000')).toBeDefined()
    })
  })

  it('Add Port appends an empty port row', async () => {
    render(ProjectSettingsView, baseProps())
    await waitFor(() => screen.getByRole('button', { name: /add port/i }))
    await fireEvent.click(screen.getByRole('button', { name: /add port/i }))
    expect(screen.getByPlaceholderText(/^container$/i)).toBeInTheDocument()
  })

  it('Save calls updateProjectPorts with parsed mappings', async () => {
    const projectWithPorts: ProjectRecord = {
      ...project,
      ports: JSON.stringify([{ container: 3000, host: 4000 }])
    }
    mockGetProject.mockResolvedValue(projectWithPorts)
    render(ProjectSettingsView, baseProps({ project: projectWithPorts }))
    await waitFor(() => screen.getByDisplayValue('3000'))
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(mockUpdatePorts).toHaveBeenCalledWith(1, [{ container: 3000, host: 4000 }])
    })
  })

  it('Save passes empty ports array when none provided', async () => {
    render(ProjectSettingsView, baseProps())
    await waitFor(() => screen.getByRole('button', { name: /save/i }))
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(mockUpdatePorts).toHaveBeenCalledWith(1, [])
    })
  })

  it('shows error on invalid port value and does not save', async () => {
    render(ProjectSettingsView, baseProps())
    await waitFor(() => screen.getByRole('button', { name: /add port/i }))
    await fireEvent.click(screen.getByRole('button', { name: /add port/i }))
    const containerInput = screen.getByPlaceholderText(/^container$/i)
    await fireEvent.input(containerInput, { target: { value: 'abc' } })
    await fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(screen.getByText(/must be a number/i)).toBeInTheDocument()
    })
    expect(mockUpdatePorts).not.toHaveBeenCalled()
  })

  it('remove port button deletes a port row', async () => {
    const projectWithPorts: ProjectRecord = {
      ...project,
      ports: JSON.stringify([{ container: 3000 }, { container: 8080 }])
    }
    mockGetProject.mockResolvedValue(projectWithPorts)
    render(ProjectSettingsView, baseProps({ project: projectWithPorts }))
    await waitFor(() => screen.getByRole('button', { name: /remove port 1/i }))
    await fireEvent.click(screen.getByRole('button', { name: /remove port 1/i }))
    await waitFor(() => {
      expect(screen.queryByDisplayValue('3000')).toBeNull()
      expect(screen.getByDisplayValue('8080')).toBeInTheDocument()
    })
  })

  describe('Import / Export .env', () => {
    it('renders Import .env and Export .env buttons', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /import \.env/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /export \.env/i })).toBeInTheDocument()
      })
    })

    it('Export .env button is disabled when no rows exist', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /export \.env/i }) as HTMLButtonElement
        expect(btn.disabled).toBe(true)
      })
    })

    it('Export .env button is enabled when rows exist', async () => {
      mockGetProject.mockResolvedValue(projectWithVars)
      render(ProjectSettingsView, baseProps({ project: projectWithVars }))
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /export \.env/i }) as HTMLButtonElement
        expect(btn.disabled).toBe(false)
      })
    })

    it('importing a .env file merges new keys and replaces existing ones', async () => {
      // Start with FOO=bar, BAZ=qux
      mockGetProject.mockResolvedValue(projectWithVars)
      render(ProjectSettingsView, baseProps({ project: projectWithVars }))
      await waitFor(() => screen.getByDisplayValue('FOO'))

      // Simulate file input change with a .env file that updates FOO and adds NEW
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const fileContent = 'FOO=updated\nNEW=value\n'
      const file = new File([fileContent], '.env', { type: 'text/plain' })

      // Mock FileReader as a class (vi.stubGlobal requires constructor-compatible value)
      class MockFileReader {
        onload: ((ev: ProgressEvent) => void) | null = null
        readAsText(_f: File): void {
          this.onload?.({ target: { result: fileContent } } as unknown as ProgressEvent)
        }
      }
      vi.stubGlobal('FileReader', MockFileReader)

      await fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByDisplayValue('updated')).toBeInTheDocument()
        expect(screen.getByDisplayValue('NEW')).toBeInTheDocument()
        expect(screen.getByDisplayValue('BAZ')).toBeInTheDocument()
      })

      vi.unstubAllGlobals()
    })
  })

  describe('Default Bridge Network section', () => {
    it('renders the network section heading', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => expect(screen.getByText(/default bridge network/i)).toBeInTheDocument())
    })

    it('renders "None (no default)" option and selects it when project.default_network is null', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => {
        const select = screen.getByRole('combobox', { name: /default bridge network/i }) as HTMLSelectElement
        expect(select.value).toBe('')
      })
    })

    it('populates dropdown with networks from listDockerNetworks', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => {
        expect(screen.getByRole('option', { name: 'app-net' })).toBeDefined()
        expect(screen.getByRole('option', { name: 'db-net' })).toBeDefined()
      })
    })

    it('calls updateProjectDefaultNetwork when a network is selected', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => screen.getByRole('combobox', { name: /default bridge network/i }))
      await fireEvent.change(
        screen.getByRole('combobox', { name: /default bridge network/i }),
        { target: { value: 'app-net' } }
      )
      await waitFor(() =>
        expect(mockUpdateProjectDefaultNetwork).toHaveBeenCalledWith(1, 'app-net')
      )
    })

    it('calls listDockerNetworks again when refresh button is clicked', async () => {
      render(ProjectSettingsView, baseProps())
      await waitFor(() => screen.getByRole('button', { name: /refresh networks/i }))
      await fireEvent.click(screen.getByRole('button', { name: /refresh networks/i }))
      expect(mockListDockerNetworks).toHaveBeenCalledTimes(2)
    })

    it('pre-selects the current default_network when set', async () => {
      const projectWithNet = { ...project, default_network: 'app-net' }
      mockGetProject.mockResolvedValue(projectWithNet)
      render(ProjectSettingsView, baseProps({ project: projectWithNet }))
      await waitFor(() => {
        const select = screen.getByRole('combobox', { name: /default bridge network/i }) as HTMLSelectElement
        expect(select.value).toBe('app-net')
      })
    })

    it('calls updateProjectDefaultNetwork with null when "None" is selected', async () => {
      const projectWithNet = { ...project, default_network: 'app-net' }
      mockGetProject.mockResolvedValue(projectWithNet)
      render(ProjectSettingsView, baseProps({ project: projectWithNet }))
      await waitFor(() => screen.getByRole('combobox', { name: /default bridge network/i }))
      await fireEvent.change(
        screen.getByRole('combobox', { name: /default bridge network/i }),
        { target: { value: '' } }
      )
      await waitFor(() =>
        expect(mockUpdateProjectDefaultNetwork).toHaveBeenCalledWith(1, null)
      )
    })
  })
})
