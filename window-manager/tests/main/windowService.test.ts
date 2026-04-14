import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

const mockExecStart = vi.fn().mockResolvedValue({ on: vi.fn() })
const mockExecInstance = { start: mockExecStart }
const mockContainerExec = vi.fn().mockResolvedValue(mockExecInstance)
const mockStart = vi.fn().mockResolvedValue(undefined)
const mockStop = vi.fn().mockResolvedValue(undefined)
const mockInspect = vi.fn().mockResolvedValue({ State: { Status: 'running' } })
const mockContainer = {
  id: 'mock-container-abc123',
  start: mockStart,
  stop: mockStop,
  inspect: mockInspect,
  exec: mockContainerExec
}
const mockCreateContainer = vi.fn().mockResolvedValue(mockContainer)
const mockGetContainer = vi.fn().mockReturnValue(mockContainer)

vi.mock('dockerode', () => ({
  default: vi.fn(function () {
    return {
      createContainer: mockCreateContainer,
      getContainer: mockGetContainer
    }
  })
}))

const mockExecFile = vi.fn((_cmd: string, _args: string[], _opts: object, cb: Function) =>
  cb(null, '', '')
)
vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...(args as [string, string[], object, Function]))
}))

const mockRm = vi.fn().mockResolvedValue(undefined)
vi.mock('fs/promises', () => ({
  rm: (...args: any[]) => mockRm(...args)
}))

const mockGetGitHubPat = vi.fn<[], string | null>()
const mockGetClaudeToken = vi.fn<[], string | null>()
vi.mock('../../src/main/settingsService', () => ({
  getGitHubPat: () => mockGetGitHubPat(),
  getClaudeToken: () => mockGetClaudeToken()
}))

const { mockCloseTerminalSessionFor } = vi.hoisted(() => ({
  mockCloseTerminalSessionFor: vi.fn()
}))

vi.mock('../../src/main/terminalService', () => ({
  closeTerminalSessionFor: mockCloseTerminalSessionFor
}))

import {
  createWindow,
  listWindows,
  deleteWindow,
  reconcileWindows,
  __resetStatusMapForTests
} from '../../src/main/windowService'

function seedProject(gitUrl: string, name = 'test'): number {
  const result = getDb()
    .prepare('INSERT INTO projects (name, git_url) VALUES (?, ?)')
    .run(name, gitUrl)
  return result.lastInsertRowid as number
}

describe('windowService', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
    vi.clearAllMocks()
    mockGetGitHubPat.mockReturnValue('test-token')
    mockGetClaudeToken.mockReturnValue('claude-oauth-token')
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: Function) => cb(null, '', '')
    )
    mockRm.mockResolvedValue(undefined)
    mockStart.mockResolvedValue(undefined)
    mockStop.mockResolvedValue(undefined)
    mockInspect.mockResolvedValue({ State: { Status: 'running' } })
    mockCreateContainer.mockResolvedValue(mockContainer)
    mockGetContainer.mockReturnValue(mockContainer)
    mockContainerExec.mockResolvedValue(mockExecInstance)
    mockExecStart.mockResolvedValue({ on: vi.fn() })
  })

  afterEach(() => {
    closeDb()
  })

  describe('createWindow', () => {
    it('returns a record with project_id and container_id', async () => {
      const projectId = seedProject('git@github.com:org/repo.git')
      const result = await createWindow('my-window', projectId)
      expect(result.name).toBe('my-window')
      expect(result.project_id).toBe(projectId)
      expect(result.container_id).toBe('mock-container-abc123')
      expect(result.id).toBeTypeOf('number')
      expect(result.created_at).toBeTypeOf('string')
    })

    it('creates a Docker container from the cc image', async () => {
      const projectId = seedProject('git@github.com:org/repo.git')
      await createWindow('test', projectId)
      expect(mockCreateContainer).toHaveBeenCalledWith(expect.objectContaining({ Image: 'cc' }))
    })

    it('passes the Claude token to the container as CLAUDE_CODE_OAUTH_TOKEN', async () => {
      const projectId = seedProject('git@github.com:org/repo.git')
      await createWindow('test', projectId)
      expect(mockCreateContainer).toHaveBeenCalledWith(
        expect.objectContaining({ Env: ['CLAUDE_CODE_OAUTH_TOKEN=claude-oauth-token'] })
      )
    })

    it('starts the container', async () => {
      const projectId = seedProject('git@github.com:org/repo.git')
      await createWindow('test', projectId)
      expect(mockStart).toHaveBeenCalled()
    })

    it('clones on the host with the PAT over HTTPS', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      await createWindow('test', projectId)

      const cloneCall = mockExecFile.mock.calls.find(
        (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'clone'
      )
      expect(cloneCall).toBeDefined()
      expect(cloneCall![1][1]).toBe('https://test-token@github.com/org/my-repo.git')
      // tempDir is git's last positional arg
      expect(cloneCall![1][2]).toMatch(/cw-clone-/)
    })

    it('rewrites origin to the SSH URL after clone (no PAT in .git/config)', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      await createWindow('test', projectId)

      const setUrl = mockExecFile.mock.calls.find(
        (c) =>
          c[0] === 'git' &&
          Array.isArray(c[1]) &&
          c[1].includes('remote') &&
          c[1].includes('set-url')
      )
      expect(setUrl).toBeDefined()
      expect(setUrl![1]).toContain('origin')
      expect(setUrl![1]).toContain('git@github.com:org/my-repo.git')
    })

    it('copies the working tree into the container via docker cp', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      await createWindow('test', projectId)

      const cpCall = mockExecFile.mock.calls.find(
        (c) => c[0] === 'docker' && Array.isArray(c[1]) && c[1][0] === 'cp'
      )
      expect(cpCall).toBeDefined()
      const [, args] = cpCall!
      expect(args[1]).toMatch(/cw-clone-.*\/\.$/)
      expect(args[2]).toBe('mock-container-abc123:/workspace/my-repo')
    })

    it('execs mkdir -p inside the container but never git clone', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      await createWindow('test', projectId)

      const mkdirExec = mockContainerExec.mock.calls.find(
        (c) => Array.isArray(c[0].Cmd) && c[0].Cmd[0] === 'mkdir'
      )
      expect(mkdirExec).toBeDefined()
      expect(mkdirExec![0].Cmd).toEqual(['mkdir', '-p', '/workspace/my-repo'])

      const cloneExec = mockContainerExec.mock.calls.find(
        (c) => Array.isArray(c[0].Cmd) && c[0].Cmd[0] === 'git' && c[0].Cmd[1] === 'clone'
      )
      expect(cloneExec).toBeUndefined()
    })

    it('never passes the PAT to any container.exec call', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      await createWindow('test', projectId)

      for (const call of mockContainerExec.mock.calls) {
        const serialized = JSON.stringify(call[0])
        expect(serialized).not.toContain('test-token')
      }
    })

    it('cleans up the host temp dir even on failure', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      mockCreateContainer.mockRejectedValueOnce(new Error('docker down'))

      await expect(createWindow('failing', projectId)).rejects.toThrow('docker down')
      expect(mockRm).toHaveBeenCalledWith(
        expect.stringMatching(/cw-clone-/),
        expect.objectContaining({ recursive: true, force: true })
      )
    })

    it('persists the window to SQLite', async () => {
      const projectId = seedProject('git@github.com:org/repo.git')
      await createWindow('persisted', projectId)
      expect(listWindows()).toHaveLength(1)
      expect(listWindows()[0].name).toBe('persisted')
    })

    it('throws if project does not exist', async () => {
      await expect(createWindow('test', 99999)).rejects.toThrow('Project not found')
    })

    it('throws when no PAT is configured', async () => {
      const projectId = seedProject('git@github.com:org/repo.git')
      mockGetGitHubPat.mockReturnValue(null)
      await expect(createWindow('no-pat', projectId)).rejects.toThrow(/PAT not configured/i)
      expect(mockCreateContainer).not.toHaveBeenCalled()
    })

    it('throws when no Claude token is configured', async () => {
      const projectId = seedProject('git@github.com:org/repo.git')
      mockGetClaudeToken.mockReturnValue(null)
      await expect(createWindow('no-claude', projectId)).rejects.toThrow(
        /Claude token not configured/i
      )
      expect(mockCreateContainer).not.toHaveBeenCalled()
    })

    it('reports progress steps in order', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      const steps: string[] = []
      await createWindow('progress', projectId, (s) => steps.push(s))
      expect(steps).toEqual([
        expect.stringMatching(/clon/i),
        expect.stringMatching(/starting/i),
        expect.stringMatching(/copy/i),
        expect.stringMatching(/finaliz/i)
      ])
    })
  })

  describe('listWindows', () => {
    it('returns empty array when no windows exist', () => {
      expect(listWindows()).toEqual([])
    })

    it('excludes soft-deleted windows', async () => {
      const projectId = seedProject('git@github.com:org/list-repo.git')
      await createWindow('active', projectId)
      await createWindow('to-delete', projectId)
      const id = listWindows().find((w) => w.name === 'to-delete')!.id
      await deleteWindow(id)
      const result = listWindows()
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('active')
    })

    it('filters by projectId when provided', async () => {
      const p1 = seedProject('git@github.com:org/filter-a.git', 'proj1')
      const p2 = seedProject('git@github.com:org/filter-b.git', 'proj2')
      await createWindow('win-a', p1)
      await createWindow('win-b', p2)
      const filtered = listWindows(p1)
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('win-a')
    })
  })

  describe('deleteWindow', () => {
    let projectId: number
    beforeEach(() => {
      projectId = seedProject('git@github.com:org/del-repo.git', 'del-test')
    })

    it('sets deleted_at in the database', async () => {
      await createWindow('to-delete', projectId)
      const [win] = listWindows()
      await deleteWindow(win.id)
      const row = getDb().prepare('SELECT deleted_at FROM windows WHERE id = ?').get(win.id) as {
        deleted_at: string | null
      }
      expect(row.deleted_at).not.toBeNull()
    })

    it('stops the Docker container', async () => {
      await createWindow('to-stop', projectId)
      const [win] = listWindows()
      await deleteWindow(win.id)
      expect(mockStop).toHaveBeenCalled()
    })

    it('returns silently when the window id does not exist', async () => {
      await expect(deleteWindow(99999)).resolves.toBeUndefined()
    })

    it('does not throw when deleted twice in a row', async () => {
      await createWindow('twice', projectId)
      const [win] = listWindows()
      await deleteWindow(win.id)
      await expect(deleteWindow(win.id)).resolves.toBeUndefined()
    })

    it('does not throw when container.stop rejects', async () => {
      await createWindow('already-stopped', projectId)
      const [win] = listWindows()
      mockStop.mockRejectedValueOnce(new Error('already stopped'))
      await expect(deleteWindow(win.id)).resolves.toBeUndefined()
    })

    it('clears the statusMap entry for the deleted window', async () => {
      await createWindow('vanish', projectId)
      const [win] = listWindows()
      expect(listWindows()[0].status).toBe('running')
      await deleteWindow(win.id)
      getDb()
        .prepare('INSERT INTO windows (name, project_id, container_id) VALUES (?, ?, ?)')
        .run('probe', projectId, 'probe-container')
      const probe = listWindows().find((r) => r.name === 'probe')!
      expect(probe.status).toBe('unknown')
    })

    it('calls closeTerminalSessionFor with the container_id', async () => {
      await createWindow('with-terminal', projectId)
      const [win] = listWindows()
      await deleteWindow(win.id)
      expect(mockCloseTerminalSessionFor).toHaveBeenCalledWith('mock-container-abc123')
    })
  })

  describe('status field', () => {
    let projectId: number
    beforeEach(() => {
      projectId = seedProject('git@github.com:org/status-repo.git', 'status-test')
    })

    it('createWindow returns status "running"', async () => {
      const result = await createWindow('with-status', projectId)
      expect(result.status).toBe('running')
    })

    it('listWindows defaults status to "unknown" when not tracked', async () => {
      getDb()
        .prepare('INSERT INTO windows (name, project_id, container_id) VALUES (?, ?, ?)')
        .run('ghost', projectId, 'ghost-container')
      const rows = listWindows()
      const ghost = rows.find((r) => r.name === 'ghost')!
      expect(ghost.status).toBe('unknown')
    })

    it('listWindows returns status "running" for windows created through the service', async () => {
      await createWindow('live', projectId)
      const rows = listWindows()
      expect(rows[0].status).toBe('running')
    })
  })

  describe('reconcileWindows', () => {
    let projectId: number
    beforeEach(() => {
      projectId = seedProject('git@github.com:org/recon-repo.git', 'recon-test')
    })

    it('marks running containers as running', async () => {
      await createWindow('alive', projectId)
      await reconcileWindows()
      const rows = listWindows()
      expect(rows[0].status).toBe('running')
    })

    it('soft-deletes rows whose container is missing (404)', async () => {
      await createWindow('gone', projectId)
      const notFound = Object.assign(new Error('no such container'), { statusCode: 404 })
      mockInspect.mockRejectedValueOnce(notFound)
      await reconcileWindows()
      expect(listWindows()).toHaveLength(0)
    })

    it('soft-deletes rows whose container is exited', async () => {
      await createWindow('stopped', projectId)
      mockInspect.mockResolvedValueOnce({ State: { Status: 'exited' } })
      await reconcileWindows()
      expect(listWindows()).toHaveLength(0)
    })

    it('leaves rows alone and marks status unknown when docker is unreachable', async () => {
      await createWindow('docker-down', projectId)
      mockInspect.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      await reconcileWindows()
      const rows = listWindows()
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('unknown')
    })
  })
})
