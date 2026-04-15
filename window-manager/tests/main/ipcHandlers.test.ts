import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  },
  BrowserWindow: {
    fromWebContents: vi.fn()
  }
}))

vi.mock('../../src/main/windowService', () => ({
  createWindow: vi.fn(),
  listWindows: vi.fn(),
  deleteWindow: vi.fn()
}))

vi.mock('../../src/main/terminalService', () => ({
  openTerminal: vi.fn(),
  writeInput: vi.fn(),
  resizeTerminal: vi.fn(),
  closeTerminal: vi.fn()
}))

vi.mock('../../src/main/projectService', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  deleteProject: vi.fn()
}))

vi.mock('../../src/main/gitOps', () => ({
  getCurrentBranch: vi.fn(),
  stageAndCommit: vi.fn(),
  push: vi.fn()
}))

vi.mock('../../src/main/settingsService', () => ({
  getGitHubPat: vi.fn(),
  getGitHubPatStatus: vi.fn(),
  setGitHubPat: vi.fn(),
  clearGitHubPat: vi.fn(),
  getClaudeTokenStatus: vi.fn(),
  setClaudeToken: vi.fn(),
  clearClaudeToken: vi.fn()
}))

vi.mock('../../src/main/githubIdentity', () => ({
  getIdentity: vi.fn()
}))

const mockContainer = { id: 'container-xyz' }
const mockGetContainer = vi.fn().mockReturnValue(mockContainer)
vi.mock('../../src/main/docker', () => ({
  getDocker: () => ({ getContainer: mockGetContainer })
}))

const mockDbGet = vi.fn()
vi.mock('../../src/main/db', () => ({
  getDb: () => ({
    prepare: () => ({ get: mockDbGet })
  })
}))

import { ipcMain, BrowserWindow } from 'electron'
import { createWindow, listWindows, deleteWindow } from '../../src/main/windowService'
import { createProject, listProjects, deleteProject } from '../../src/main/projectService'
import {
  openTerminal,
  writeInput,
  resizeTerminal,
  closeTerminal
} from '../../src/main/terminalService'
import { getCurrentBranch, stageAndCommit, push } from '../../src/main/gitOps'
import { getGitHubPat } from '../../src/main/settingsService'
import { getIdentity } from '../../src/main/githubIdentity'
import { registerIpcHandlers } from '../../src/main/ipcHandlers'

const mockWin = { webContents: {} } as any

function getHandler(channel: string) {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const call = calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: any[]) => any
}

function getListener(channel: string) {
  const calls = vi.mocked(ipcMain.on).mock.calls
  const call = calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No listener registered for ${channel}`)
  return call[1] as (...args: any[]) => any
}

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbGet.mockReset()
    mockGetContainer.mockClear()
    registerIpcHandlers()
  })

  it('registers project:create handler that calls createProject', async () => {
    const record = {
      id: 1,
      name: 'test',
      git_url: 'git@github.com:org/repo.git',
      created_at: '2026-01-01'
    }
    vi.mocked(createProject).mockResolvedValue(record)
    const result = await getHandler('project:create')({}, 'test', 'git@github.com:org/repo.git')
    expect(createProject).toHaveBeenCalledWith('test', 'git@github.com:org/repo.git', undefined)
    expect(result).toEqual(record)
  })

  it('registers project:list handler that calls listProjects', async () => {
    const records = [
      { id: 1, name: 'p', git_url: 'git@github.com:org/repo.git', created_at: '2026-01-01' }
    ]
    vi.mocked(listProjects).mockReturnValue(records)
    const result = await getHandler('project:list')({})
    expect(listProjects).toHaveBeenCalled()
    expect(result).toEqual(records)
  })

  it('registers project:delete handler that calls deleteProject', async () => {
    vi.mocked(deleteProject).mockResolvedValue(undefined)
    await getHandler('project:delete')({}, 1)
    expect(deleteProject).toHaveBeenCalledWith(1)
  })

  it('registers window:create handler that calls createWindow', async () => {
    const record = {
      id: 1,
      name: 'test',
      project_id: 1,
      container_id: 'abc',
      created_at: '2026-01-01',
      status: 'running' as const
    }
    vi.mocked(createWindow).mockResolvedValue(record)
    const fakeSender = { send: vi.fn() }
    const result = await getHandler('window:create')({ sender: fakeSender }, 'test', 1)
    expect(createWindow).toHaveBeenCalledWith('test', 1, expect.any(Function))
    expect(result).toEqual(record)

    // The progress callback should route to the event's sender.
    const progressCb = vi.mocked(createWindow).mock.calls[0][2] as (s: string) => void
    progressCb('Cloning…')
    expect(fakeSender.send).toHaveBeenCalledWith('window:create-progress', 'Cloning…')
  })

  it('registers window:list handler that calls listWindows', async () => {
    const records = [
      { id: 1, name: 'w', container_id: 'x', created_at: '2026-01-01', status: 'running' as const }
    ]
    vi.mocked(listWindows).mockReturnValue(records)
    const result = await getHandler('window:list')({})
    expect(listWindows).toHaveBeenCalled()
    expect(result).toEqual(records)
  })

  it('registers window:delete handler that calls deleteWindow', async () => {
    vi.mocked(deleteWindow).mockResolvedValue(undefined)
    await getHandler('window:delete')({}, 1)
    expect(deleteWindow).toHaveBeenCalledWith(1)
  })

  it('registers terminal:open handler that calls openTerminal', async () => {
    vi.mocked(openTerminal).mockResolvedValue(undefined)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)
    // mockDbGet returns undefined → workDir resolves to undefined
    await getHandler('terminal:open')({ sender: {} }, 'container-abc', 120, 40, 'my-window')
    expect(openTerminal).toHaveBeenCalledWith('container-abc', mockWin, 120, 40, 'my-window', undefined)
  })

  it('terminal:open passes displayName as 5th arg to openTerminal', async () => {
    vi.mocked(openTerminal).mockResolvedValue(undefined)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)
    await getHandler('terminal:open')({ sender: {} }, 'ctr-1', 80, 24, 'my-display-name')
    expect(openTerminal).toHaveBeenCalledWith('ctr-1', mockWin, 80, 24, 'my-display-name', undefined)
  })

  it('terminal:open resolves workDir from DB and passes to openTerminal', async () => {
    vi.mocked(openTerminal).mockResolvedValue(undefined)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)
    mockDbGet.mockReturnValue({ git_url: 'git@github.com:org/my-repo.git' })
    await getHandler('terminal:open')({ sender: {} }, 'container-abc', 80, 24, 'win')
    expect(openTerminal).toHaveBeenCalledWith('container-abc', mockWin, 80, 24, 'win', '/workspace/my-repo')
  })

  it('registers terminal:input listener that calls writeInput', () => {
    getListener('terminal:input')({}, 'container-abc', 'ls\n')
    expect(writeInput).toHaveBeenCalledWith('container-abc', 'ls\n')
  })

  it('registers terminal:resize listener that calls resizeTerminal', () => {
    getListener('terminal:resize')({}, 'container-abc', 80, 24)
    expect(resizeTerminal).toHaveBeenCalledWith('container-abc', 80, 24)
  })

  it('registers terminal:close listener that calls closeTerminal', () => {
    getListener('terminal:close')({}, 'container-abc')
    expect(closeTerminal).toHaveBeenCalledWith('container-abc')
  })

  it('registers git:current-branch handler that returns the trimmed branch', async () => {
    mockDbGet.mockReturnValue({
      containerId: 'container-xyz',
      gitUrl: 'git@github.com:org/my-repo.git'
    })
    vi.mocked(getCurrentBranch).mockResolvedValue('feature-x')

    const result = await getHandler('git:current-branch')({}, 42)
    expect(mockDbGet).toHaveBeenCalledWith(42)
    expect(mockGetContainer).toHaveBeenCalledWith('container-xyz')
    expect(getCurrentBranch).toHaveBeenCalledWith(mockContainer, '/workspace/my-repo')
    expect(result).toBe('feature-x')
  })

  it('git:current-branch throws when the window does not exist', async () => {
    mockDbGet.mockReturnValue(undefined)
    await expect(getHandler('git:current-branch')({}, 9999)).rejects.toThrow(/window not found/i)
  })

  it('registers git:commit handler that scrubs PAT from stdout', async () => {
    vi.mocked(getGitHubPat).mockReturnValue('my-pat')
    mockDbGet.mockReturnValue({
      containerId: 'container-xyz',
      gitUrl: 'git@github.com:org/my-repo.git'
    })
    vi.mocked(getIdentity).mockResolvedValue({ name: 'Octo', email: 'o@x' })
    vi.mocked(stageAndCommit).mockResolvedValue({
      ok: true,
      code: 0,
      stdout: 'pushing via https://my-pat@github.com/org/my-repo.git'
    })

    const result = await getHandler('git:commit')({}, 7, { subject: 'Fix bug', body: 'details' })

    expect(stageAndCommit).toHaveBeenCalledWith(mockContainer, '/workspace/my-repo', {
      subject: 'Fix bug',
      body: 'details',
      name: 'Octo',
      email: 'o@x'
    })
    expect(result.ok).toBe(true)
    expect(result.stdout).not.toContain('my-pat')
    expect(result.stdout).toContain('***')
  })

  it('git:commit throws when PAT is not configured', async () => {
    vi.mocked(getGitHubPat).mockReturnValue(null)
    await expect(getHandler('git:commit')({}, 7, { subject: 's' })).rejects.toThrow(
      /pat not configured/i
    )
  })

  it('git:commit throws when the window is not found', async () => {
    vi.mocked(getGitHubPat).mockReturnValue('my-pat')
    mockDbGet.mockReturnValue(undefined)
    await expect(getHandler('git:commit')({}, 9999, { subject: 's' })).rejects.toThrow(
      /window not found/i
    )
  })

  it('git:commit returns ok=false unchanged when stageAndCommit fails', async () => {
    vi.mocked(getGitHubPat).mockReturnValue('my-pat')
    mockDbGet.mockReturnValue({
      containerId: 'container-xyz',
      gitUrl: 'git@github.com:org/my-repo.git'
    })
    vi.mocked(getIdentity).mockResolvedValue({ name: 'Octo', email: 'o@x' })
    vi.mocked(stageAndCommit).mockResolvedValue({
      ok: false,
      code: 1,
      stdout: 'nothing to commit, working tree clean'
    })

    const result = await getHandler('git:commit')({}, 7, { subject: 's' })
    expect(result.ok).toBe(false)
    expect(result.code).toBe(1)
    expect(result.stdout).toMatch(/nothing to commit/i)
  })

  it('registers git:push handler that calls push with the resolved branch + gitUrl', async () => {
    vi.mocked(getGitHubPat).mockReturnValue('my-pat')
    mockDbGet.mockReturnValue({
      containerId: 'container-xyz',
      gitUrl: 'git@github.com:org/my-repo.git'
    })
    vi.mocked(getCurrentBranch).mockResolvedValue('my-feature')
    vi.mocked(push).mockResolvedValue({
      ok: true,
      code: 0,
      stdout: ''
    })

    const result = await getHandler('git:push')({}, 7)

    expect(getCurrentBranch).toHaveBeenCalledWith(mockContainer, '/workspace/my-repo')
    expect(push).toHaveBeenCalledWith(
      mockContainer,
      '/workspace/my-repo',
      'my-feature',
      'git@github.com:org/my-repo.git',
      'my-pat'
    )
    expect(result.ok).toBe(true)
  })

  it('git:push throws when PAT is not configured', async () => {
    vi.mocked(getGitHubPat).mockReturnValue(null)
    await expect(getHandler('git:push')({}, 7)).rejects.toThrow(/pat not configured/i)
  })

  it('git:push throws when the window is not found', async () => {
    vi.mocked(getGitHubPat).mockReturnValue('my-pat')
    mockDbGet.mockReturnValue(undefined)
    await expect(getHandler('git:push')({}, 9999)).rejects.toThrow(/window not found/i)
  })

  it('git:push throws on detached HEAD', async () => {
    vi.mocked(getGitHubPat).mockReturnValue('my-pat')
    mockDbGet.mockReturnValue({
      containerId: 'container-xyz',
      gitUrl: 'git@github.com:org/my-repo.git'
    })
    vi.mocked(getCurrentBranch).mockResolvedValue('HEAD')
    await expect(getHandler('git:push')({}, 7)).rejects.toThrow(/detached HEAD|branch unknown/i)
  })

  it('git:push throws when the branch is empty', async () => {
    vi.mocked(getGitHubPat).mockReturnValue('my-pat')
    mockDbGet.mockReturnValue({
      containerId: 'container-xyz',
      gitUrl: 'git@github.com:org/my-repo.git'
    })
    vi.mocked(getCurrentBranch).mockResolvedValue('')
    await expect(getHandler('git:push')({}, 7)).rejects.toThrow(/detached HEAD|branch unknown/i)
  })

  it('git:push passes push failures through (ok=false)', async () => {
    vi.mocked(getGitHubPat).mockReturnValue('my-pat')
    mockDbGet.mockReturnValue({
      containerId: 'container-xyz',
      gitUrl: 'git@github.com:org/my-repo.git'
    })
    vi.mocked(getCurrentBranch).mockResolvedValue('my-feature')
    vi.mocked(push).mockResolvedValue({
      ok: false,
      code: 1,
      stdout: '! [rejected] non-fast-forward'
    })
    const result = await getHandler('git:push')({}, 7)
    expect(result.ok).toBe(false)
    expect(result.code).toBe(1)
    expect(result.stdout).toMatch(/non-fast-forward/)
  })
})
