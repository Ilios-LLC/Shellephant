import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewWindowWizard from '../../src/renderer/src/components/NewWindowWizard.svelte'
import type { ProjectRecord, WindowRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1, name: 'my-project', git_url: 'https://github.com/x/y', created_at: ''
}

const mockWindow: WindowRecord = {
  id: 10, name: 'dev', project_id: 1, container_id: 'abc', created_at: '', status: 'running', projects: [], window_type: 'manual'
}

function baseProps(overrides = {}) {
  return { project, onCreated: vi.fn(), onCancel: vi.fn(), ...overrides }
}

let mockListDeps: ReturnType<typeof vi.fn>
let mockCreateWindow: ReturnType<typeof vi.fn>
let mockOnProgress: ReturnType<typeof vi.fn>
let mockOffProgress: ReturnType<typeof vi.fn>
let mockListRemoteBranches: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockListDeps = vi.fn().mockResolvedValue([])
  mockCreateWindow = vi.fn().mockResolvedValue(mockWindow)
  mockOnProgress = vi.fn()
  mockOffProgress = vi.fn()
  mockListRemoteBranches = vi.fn().mockResolvedValue({
    defaultBranch: 'main',
    branches: ['main', 'develop', 'feature/x']
  })
  vi.stubGlobal('api', {
    listDependencies: mockListDeps,
    createWindow: mockCreateWindow,
    onWindowCreateProgress: mockOnProgress,
    offWindowCreateProgress: mockOffProgress,
    listRemoteBranches: mockListRemoteBranches,
    getFireworksKeyStatus: vi.fn().mockResolvedValue({ configured: false, hint: null })
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

  it('shows branch select with options loaded from listRemoteBranches', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /branch/i })
      expect(select).toBeDefined()
      expect((select as HTMLSelectElement).options.length).toBe(3)
    })
  })

  it('default branch is pre-selected in branch select', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /branch/i }) as HTMLSelectElement
      expect(select.value).toBe('main')
    })
  })

  it('shows disabled select with "(default)" text when branch fetch fails', async () => {
    mockListRemoteBranches.mockRejectedValue(new Error('network error'))
    render(NewWindowWizard, baseProps())
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /branch/i }) as HTMLSelectElement
      expect(select.disabled).toBe(true)
    })
  })

  it('calls createWindow with empty branchOverrides when default branch selected', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('combobox', { name: /branch/i }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1], false, {}, 'manual', '')
    )
  })

  it('calls createWindow with branchOverrides when non-default branch selected', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('combobox', { name: /branch/i }))
    await fireEvent.change(screen.getByRole('combobox', { name: /branch/i }), { target: { value: 'develop' } })
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1], false, { 1: 'develop' }, 'manual', '')
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
    await waitFor(() => expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1], false, {}, 'manual', ''))
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
    await waitFor(() => expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1], true, {}, 'manual', ''))
  })
})

describe('multi-project mode', () => {
  const p1: ProjectRecord = { id: 1, name: 'project-one', git_url: 'https://github.com/x/a', created_at: '' }
  const p2: ProjectRecord = { id: 2, name: 'project-two', git_url: 'https://github.com/x/b', created_at: '' }
  const p3: ProjectRecord = { id: 3, name: 'project-three', git_url: 'https://github.com/x/c', created_at: '' }

  function multiProps(overrides = {}) {
    return { projects: [p1, p2, p3], onCreated: vi.fn(), onCancel: vi.fn(), ...overrides }
  }

  it('renders checkboxes for each project, all unchecked by default', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes).toHaveLength(3)
      checkboxes.forEach(cb => expect((cb as HTMLInputElement).checked).toBe(false))
    })
  })

  it('checking a project adds it to selection', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('checkbox'))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-one' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-three' }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('mywin', [1, 3], false, {}, 'manual', '')
    )
  })

  it('Create button is disabled when no projects are selected', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('checkbox'))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'mywin' } })
    const createBtn = screen.getByRole('button', { name: /create window/i })
    expect((createBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls createWindow with selectedProjectIds when Create is clicked', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('checkbox'))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-one' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-two' }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'multi-win' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('multi-win', [1, 2], false, {}, 'manual', '')
    )
  })

  it('each project row has a branch select loaded from listRemoteBranches', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => {
      const selects = screen.getAllByRole('combobox')
      expect(selects).toHaveLength(3)
    })
  })

  it('passes branchOverrides for project where non-default branch selected', async () => {
    render(NewWindowWizard, multiProps())
    await waitFor(() => screen.getAllByRole('combobox'))
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    await fireEvent.change(selects[1], { target: { value: 'develop' } })
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-one' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'project-two' }))
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'multi-win' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('multi-win', [1, 2], false, { 2: 'develop' }, 'manual', '')
    )
  })
})

describe('window type toggle', () => {
  it('renders Manual and Assisted radio options', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => {
      const radios = screen.getAllByRole('radio')
      expect(radios).toHaveLength(2)
    })
    expect(screen.getByLabelText('Assisted')).toBeDefined()
  })

  it('Assisted option is disabled when no fireworks key configured', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByLabelText('Assisted'))
    const assistedRadio = screen.getByLabelText('Assisted') as HTMLInputElement
    expect(assistedRadio.disabled).toBe(true)
    const assistedLabel = assistedRadio.closest('label') as HTMLElement
    expect(assistedLabel.title).toBe('Set Fireworks API key in Settings')
  })

  it('calls getFireworksKeyStatus on mount', async () => {
    const mockFwStatus = vi.fn().mockResolvedValue({ configured: false, hint: null })
    vi.stubGlobal('api', {
      listDependencies: mockListDeps,
      createWindow: mockCreateWindow,
      onWindowCreateProgress: mockOnProgress,
      offWindowCreateProgress: mockOffProgress,
      listRemoteBranches: mockListRemoteBranches,
      getFireworksKeyStatus: mockFwStatus
    })
    render(NewWindowWizard, baseProps())
    await waitFor(() => expect(mockFwStatus).toHaveBeenCalled())
  })

  it('passes assisted windowType to createWindow when Assisted selected', async () => {
    vi.stubGlobal('api', {
      listDependencies: mockListDeps,
      createWindow: mockCreateWindow,
      onWindowCreateProgress: mockOnProgress,
      offWindowCreateProgress: mockOffProgress,
      listRemoteBranches: mockListRemoteBranches,
      getFireworksKeyStatus: vi.fn().mockResolvedValue({ configured: true, hint: '5678' })
    })
    render(NewWindowWizard, baseProps())
    await waitFor(() => {
      const radio = screen.getByLabelText('Assisted') as HTMLInputElement
      expect(radio.disabled).toBe(false)
    })
    const assistedRadio = screen.getByLabelText('Assisted') as HTMLInputElement
    await fireEvent.click(assistedRadio)
    await fireEvent.input(screen.getByPlaceholderText(/dev-window/i), { target: { value: 'my-window' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('my-window', [1], false, {}, 'assisted', '')
    )
  })
})

describe('network mode radio group', () => {
  it('renders auto-create, use-default, and custom radio options', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /auto-create/i })).toBeDefined()
      expect(screen.getByRole('radio', { name: /use project default/i })).toBeDefined()
      expect(screen.getByRole('radio', { name: /custom/i })).toBeDefined()
    })
  })

  it('"Use project default" is disabled when project has no default_network', async () => {
    render(NewWindowWizard, baseProps({ project: { ...project, default_network: null } }))
    await waitFor(() => {
      const radio = screen.getByRole('radio', { name: /use project default/i }) as HTMLInputElement
      expect(radio.disabled).toBe(true)
    })
  })

  it('pre-selects "Use project default" when project.default_network is set', async () => {
    render(NewWindowWizard, baseProps({ project: { ...project, default_network: 'my-net' } }))
    await waitFor(() => {
      const radio = screen.getByRole('radio', { name: /use project default/i }) as HTMLInputElement
      expect(radio.checked).toBe(true)
    })
  })

  it('pre-selects "Auto-create" when project has no default_network', async () => {
    render(NewWindowWizard, baseProps({ project: { ...project, default_network: null } }))
    await waitFor(() => {
      const radio = screen.getByRole('radio', { name: /auto-create/i }) as HTMLInputElement
      expect(radio.checked).toBe(true)
    })
  })

  it('"Use project default" is disabled in multi-project mode', async () => {
    const p2: ProjectRecord = { id: 2, name: 'p2', git_url: 'git@github.com:x/p2.git', created_at: '', default_network: 'some-net' }
    render(NewWindowWizard, {
      projects: [{ ...project, default_network: 'my-net' }, p2],
      onCreated: vi.fn(),
      onCancel: vi.fn()
    })
    await waitFor(() => {
      const radio = screen.getByRole('radio', { name: /use project default/i }) as HTMLInputElement
      expect(radio.disabled).toBe(true)
    })
  })

  it('Custom option reveals a network name text input', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('radio', { name: /custom/i }))
    await fireEvent.click(screen.getByRole('radio', { name: /custom/i }))
    await waitFor(() => expect(screen.getByPlaceholderText('network-name')).toBeDefined())
  })

  it('withDeps=true disables the network fieldset', async () => {
    mockListDeps.mockResolvedValue([
      { id: 1, project_id: 1, image: 'redis', tag: 'latest', env_vars: null, created_at: '' }
    ])
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('checkbox', { name: /start with dependencies/i }))
    await fireEvent.click(screen.getByRole('checkbox', { name: /start with dependencies/i }))
    await waitFor(() => {
      const fieldset = screen.getByRole('group', { name: /docker network/i })
      expect(fieldset).toBeDisabled()
    })
  })

  it('passes empty netArg when "Auto-create" is selected', async () => {
    render(NewWindowWizard, baseProps({ project: { ...project, default_network: 'my-net' } }))
    await waitFor(() => screen.getByRole('combobox', { name: /branch/i }))
    await fireEvent.click(screen.getByRole('radio', { name: /auto-create/i }))
    await fireEvent.input(screen.getByPlaceholderText('dev-window'), { target: { value: 'w1' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('w1', [1], false, {}, '')
    )
  })

  it('passes project default_network as netArg for "Use project default"', async () => {
    render(NewWindowWizard, baseProps({ project: { ...project, default_network: 'my-net' } }))
    await waitFor(() => screen.getByRole('combobox', { name: /branch/i }))
    await fireEvent.input(screen.getByPlaceholderText('dev-window'), { target: { value: 'w2' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('w2', [1], false, {}, 'my-net')
    )
  })

  it('passes trimmed custom input as netArg for "Custom"', async () => {
    render(NewWindowWizard, baseProps())
    await waitFor(() => screen.getByRole('combobox', { name: /branch/i }))
    await fireEvent.click(screen.getByRole('radio', { name: /custom/i }))
    await waitFor(() => screen.getByPlaceholderText('network-name'))
    await fireEvent.input(screen.getByPlaceholderText('network-name'), { target: { value: '  custom-net  ' } })
    await fireEvent.input(screen.getByPlaceholderText('dev-window'), { target: { value: 'w3' } })
    await fireEvent.click(screen.getByRole('button', { name: /create window/i }))
    await waitFor(() =>
      expect(mockCreateWindow).toHaveBeenCalledWith('w3', [1], false, {}, 'custom-net')
    )
  })
})
