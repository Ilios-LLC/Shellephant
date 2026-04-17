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
  deleteProject: vi.fn(),
  updateProject: vi.fn(),
  getProject: vi.fn(),
  updateProjectEnvVars: vi.fn()
}))

vi.mock('../../src/main/projectGroupService', () => ({
  createGroup: vi.fn(),
  listGroups: vi.fn()
}))

vi.mock('../../src/main/gitOps', () => ({
  getCurrentBranch: vi.fn(),
  stageAndCommit: vi.fn(),
  push: vi.fn(),
  listContainerDir: vi.fn(),
  readContainerFile: vi.fn(),
  writeFileInContainer: vi.fn(),
  execInContainer: vi.fn()
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
import { createProject, listProjects, deleteProject, updateProject, getProject, updateProjectEnvVars } from '../../src/main/projectService'
import { createGroup, listGroups } from '../../src/main/projectGroupService'
import {
  openTerminal,
  writeInput,
  resizeTerminal,
  closeTerminal
} from '../../src/main/terminalService'
import { getCurrentBranch, stageAndCommit, push, listContainerDir, readContainerFile, writeFileInContainer, execInContainer } from '../../src/main/gitOps'
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
    expect(createWindow).toHaveBeenCalledWith('test', 1, false, expect.any(Function))
    expect(result).toEqual(record)

    // The progress callback should route to the event's sender.
    const progressCb = vi.mocked(createWindow).mock.calls[0][3] as (s: string) => void
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

  it('registers terminal:open handler that calls openTerminal with sessionType', async () => {
    vi.mocked(openTerminal).mockResolvedValue(undefined)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)
    await getHandler('terminal:open')({ sender: {} }, 'container-abc', 120, 40, 'my-window', 'claude')
    expect(openTerminal).toHaveBeenCalledWith('container-abc', mockWin, 120, 40, 'my-window', undefined, 'claude')
  })

  it('terminal:open defaults sessionType to terminal when omitted', async () => {
    vi.mocked(openTerminal).mockResolvedValue(undefined)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)
    await getHandler('terminal:open')({ sender: {} }, 'container-abc', 120, 40, 'my-window')
    expect(openTerminal).toHaveBeenCalledWith('container-abc', mockWin, 120, 40, 'my-window', undefined, 'terminal')
  })

  it('terminal:open resolves workDir from DB and passes to openTerminal', async () => {
    vi.mocked(openTerminal).mockResolvedValue(undefined)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin)
    mockDbGet.mockReturnValue({ git_url: 'git@github.com:org/my-repo.git' })
    await getHandler('terminal:open')({ sender: {} }, 'container-abc', 80, 24, 'win', 'terminal')
    expect(openTerminal).toHaveBeenCalledWith('container-abc', mockWin, 80, 24, 'win', '/workspace/my-repo', 'terminal')
  })

  it('registers terminal:input listener that calls writeInput with sessionType', () => {
    getListener('terminal:input')({}, 'container-abc', 'ls\n', 'claude')
    expect(writeInput).toHaveBeenCalledWith('container-abc', 'ls\n', 'claude')
  })

  it('terminal:input defaults sessionType to terminal', () => {
    getListener('terminal:input')({}, 'container-abc', 'ls\n')
    expect(writeInput).toHaveBeenCalledWith('container-abc', 'ls\n', 'terminal')
  })

  it('registers terminal:resize listener that calls resizeTerminal with sessionType', () => {
    getListener('terminal:resize')({}, 'container-abc', 80, 24, 'claude')
    expect(resizeTerminal).toHaveBeenCalledWith('container-abc', 80, 24, 'claude')
  })

  it('terminal:resize defaults sessionType to terminal', () => {
    getListener('terminal:resize')({}, 'container-abc', 80, 24)
    expect(resizeTerminal).toHaveBeenCalledWith('container-abc', 80, 24, 'terminal')
  })

  it('registers terminal:close listener that calls closeTerminal with sessionType', () => {
    getListener('terminal:close')({}, 'container-abc', 'claude')
    expect(closeTerminal).toHaveBeenCalledWith('container-abc', 'claude')
  })

  it('terminal:close defaults sessionType to terminal', () => {
    getListener('terminal:close')({}, 'container-abc')
    expect(closeTerminal).toHaveBeenCalledWith('container-abc', 'terminal')
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

  it('registers fs:list-dir handler that calls listContainerDir', async () => {
    const entries = [{ name: 'src', isDir: true }, { name: 'README.md', isDir: false }]
    vi.mocked(listContainerDir).mockResolvedValue(entries)
    const result = await getHandler('fs:list-dir')({}, 'container-xyz', '/workspace/r')
    expect(mockGetContainer).toHaveBeenCalledWith('container-xyz')
    expect(listContainerDir).toHaveBeenCalledWith(mockContainer, '/workspace/r')
    expect(result).toEqual(entries)
  })

  it('registers fs:read-file handler that calls readContainerFile', async () => {
    vi.mocked(readContainerFile).mockResolvedValue('file content')
    const result = await getHandler('fs:read-file')({}, 'container-xyz', '/workspace/r/file.ts')
    expect(mockGetContainer).toHaveBeenCalledWith('container-xyz')
    expect(readContainerFile).toHaveBeenCalledWith(mockContainer, '/workspace/r/file.ts')
    expect(result).toBe('file content')
  })

  it('fs:read-file propagates rejection from readContainerFile', async () => {
    vi.mocked(readContainerFile).mockRejectedValue(new Error('readContainerFile failed (exit 1): /no/such'))
    await expect(
      getHandler('fs:read-file')({}, 'container-xyz', '/no/such')
    ).rejects.toThrow(/readContainerFile failed/)
  })

  it('registers fs:write-file handler that calls writeFileInContainer', async () => {
    vi.mocked(writeFileInContainer).mockResolvedValue(undefined)
    await getHandler('fs:write-file')({}, 'container-xyz', '/workspace/r/file.ts', 'new content')
    expect(mockGetContainer).toHaveBeenCalledWith('container-xyz')
    expect(writeFileInContainer).toHaveBeenCalledWith(mockContainer, '/workspace/r/file.ts', 'new content')
  })

  it('registers fs:exec handler that calls execInContainer for allowed command', async () => {
    vi.mocked(execInContainer).mockResolvedValue({ ok: true, code: 0, stdout: 'result' })
    const cmd = ['grep', '-rn', 'foo', '/workspace/r']
    const result = await getHandler('fs:exec')({}, 'container-xyz', cmd)
    expect(mockGetContainer).toHaveBeenCalledWith('container-xyz')
    expect(execInContainer).toHaveBeenCalledWith(mockContainer, cmd)
    expect(result).toEqual({ ok: true, code: 0, stdout: 'result' })
  })

  it('fs:exec throws for disallowed command', async () => {
    await expect(
      getHandler('fs:exec')({}, 'container-xyz', ['rm', '-rf', '/'])
    ).rejects.toThrow("not permitted")
  })

  it('fs:exec throws for empty command array', async () => {
    await expect(
      getHandler('fs:exec')({}, 'container-xyz', [])
    ).rejects.toThrow("not permitted")
  })

  it('registers project:update handler that calls updateProject', async () => {
    const updated = { id: 1, name: 'p', git_url: 'git@github.com:org/r.git', group_id: 2, created_at: '2026-01-01' }
    vi.mocked(updateProject).mockReturnValue(updated)
    const result = await getHandler('project:update')({}, 1, { groupId: 2 })
    expect(updateProject).toHaveBeenCalledWith(1, { groupId: 2 })
    expect(result).toEqual(updated)
  })

  it('registers group:create handler that calls createGroup', async () => {
    const group = { id: 1, name: 'frontend', created_at: '2026-01-01' }
    vi.mocked(createGroup).mockReturnValue(group)
    const result = await getHandler('group:create')({}, 'frontend')
    expect(createGroup).toHaveBeenCalledWith('frontend')
    expect(result).toEqual(group)
  })

  it('registers group:list handler that calls listGroups', async () => {
    const groups = [{ id: 1, name: 'frontend', created_at: '2026-01-01' }]
    vi.mocked(listGroups).mockReturnValue(groups)
    const result = await getHandler('group:list')({})
    expect(listGroups).toHaveBeenCalled()
    expect(result).toEqual(groups)
  })

  it('registers project:get handler that calls getProject', async () => {
    const record = {
      id: 1,
      name: 'test',
      git_url: 'git@github.com:org/repo.git',
      created_at: '2026-01-01',
      env_vars: null
    }
    vi.mocked(getProject).mockReturnValue(record)
    const result = await getHandler('project:get')({}, 1)
    expect(getProject).toHaveBeenCalledWith(1)
    expect(result).toEqual(record)
  })

  it('registers project:update-env-vars handler that calls updateProjectEnvVars', async () => {
    vi.mocked(updateProjectEnvVars).mockReturnValue(undefined)
    await getHandler('project:update-env-vars')({}, 1, { FOO: 'bar' })
    expect(updateProjectEnvVars).toHaveBeenCalledWith(1, { FOO: 'bar' })
  })
})
