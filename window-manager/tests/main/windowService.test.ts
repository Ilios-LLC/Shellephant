import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

const mockExecStart = vi.fn().mockResolvedValue({
  on(event: string, cb: (data?: Buffer) => void) {
    if (event === 'end') setImmediate(() => cb())
    return this
  }
})
const mockExecInspect = vi.fn().mockResolvedValue({ ExitCode: 0 })
const mockExecInstance = { start: mockExecStart, inspect: mockExecInspect }
const mockContainerExec = vi.fn().mockResolvedValue(mockExecInstance)
const mockStart = vi.fn().mockResolvedValue(undefined)
const mockStop = vi.fn().mockResolvedValue(undefined)
const mockRemove = vi.fn().mockResolvedValue(undefined)
const mockInspect = vi.fn().mockResolvedValue({ State: { Status: 'running' } })
const mockContainer = {
  id: 'mock-container-abc123',
  start: mockStart,
  stop: mockStop,
  remove: mockRemove,
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

interface PortMapping { container: number; host?: number }

function seedProject(gitUrl: string, name = 'test', ports?: PortMapping[], envVars?: Record<string, string>): number {
  const result = getDb()
    .prepare('INSERT INTO projects (name, git_url, ports, env_vars) VALUES (?, ?, ?, ?)')
    .run(name, gitUrl, ports ? JSON.stringify(ports) : null, envVars ? JSON.stringify(envVars) : null)
  return result.lastInsertRowid as number
}

describe('windowService', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
    vi.clearAllMocks()
    mockGetGitHubPat.mockReturnValue('test-token')
    mockGetClaudeToken.mockReturnValue('claude-oauth-token')
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, '', '')
    )
    mockStart.mockResolvedValue(undefined)
    mockStop.mockResolvedValue(undefined)
    mockRemove.mockResolvedValue(undefined)
    mockInspect.mockResolvedValue({ State: { Status: 'running' } })
    mockCreateContainer.mockResolvedValue(mockContainer)
    mockGetContainer.mockReturnValue(mockContainer)
    mockContainerExec.mockResolvedValue(mockExecInstance)
    mockExecStart.mockResolvedValue({
      on(event: string, cb: (data?: Buffer) => void) {
        if (event === 'end') setImmediate(() => cb())
        return this
      }
    })
    mockExecInspect.mockResolvedValue({ ExitCode: 0 })
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

    it('rewrites origin to the SSH URL after clone (no PAT in .git/config)', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      await createWindow('test', projectId)

      const setUrl = mockContainerExec.mock.calls.find(
        (c) =>
          Array.isArray(c[0].Cmd) && c[0].Cmd.includes('remote') && c[0].Cmd.includes('set-url')
      )
      expect(setUrl).toBeDefined()
      expect(setUrl![0].Cmd).toContain('origin')
      expect(setUrl![0].Cmd).toContain('git@github.com:org/my-repo.git')
    })

    it('execs mkdir -p inside the container and then git clone', async () => {
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
      expect(cloneExec).toBeDefined()
    })

    it('creates the clone path and clones the repo inside the container', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      await createWindow('test window', projectId)

      const cloneExec = mockContainerExec.mock.calls.find(
        (c) => Array.isArray(c[0].Cmd) && c[0].Cmd[0] === 'git' && c[0].Cmd[1] === 'clone'
      )
      expect(cloneExec).toBeDefined()
      expect(cloneExec![0].Cmd).toEqual([
        'git',
        'clone',
        'https://test-token@github.com/org/my-repo.git',
        '/workspace/my-repo'
      ])
    })

    it('rewrites origin back to the SSH URL after the in-container clone', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      await createWindow('test window', projectId)

      const setUrl = mockContainerExec.mock.calls.find(
        (c) =>
          Array.isArray(c[0].Cmd) && c[0].Cmd.includes('remote') && c[0].Cmd.includes('set-url')
      )
      expect(setUrl).toBeDefined()
      expect(setUrl![0].Cmd).toContain('git@github.com:org/my-repo.git')
    })

    it('probes the remote for the slug branch before cloning', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      await createWindow('My Feature', projectId)

      const lsRemote = mockExecFile.mock.calls.find(
        (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'ls-remote'
      )
      expect(lsRemote).toBeDefined()
      expect(lsRemote![1]).toEqual([
        'ls-remote',
        '--heads',
        'https://test-token@github.com/org/my-repo.git',
        'my-feature'
      ])
    })

    it('uses `checkout -b` when remote has no matching branch', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      // Default mockExecFile returns empty stdout → remoteBranchExists → false
      await createWindow('My Feature', projectId)

      const checkout = mockContainerExec.mock.calls.find(
        (c) => Array.isArray(c[0].Cmd) && c[0].Cmd.includes('checkout')
      )
      expect(checkout).toBeDefined()
      expect(checkout![0].Cmd).toEqual([
        'git',
        '-C',
        '/workspace/my-repo',
        'checkout',
        '-b',
        'my-feature'
      ])
    })

    it('uses plain `checkout <slug>` when remote has the branch', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], _opts: object, cb: Function) => {
          if (cmd === 'git' && args[0] === 'ls-remote') {
            return cb(null, 'deadbeef\trefs/heads/my-feature\n', '')
          }
          return cb(null, '', '')
        }
      )
      await createWindow('My Feature', projectId)

      const checkout = mockContainerExec.mock.calls.find(
        (c) => Array.isArray(c[0].Cmd) && c[0].Cmd.includes('checkout')
      )
      expect(checkout).toBeDefined()
      expect(checkout![0].Cmd).toEqual([
        'git',
        '-C',
        '/workspace/my-repo',
        'checkout',
        'my-feature'
      ])
    })

    it('stops and removes the container if the clone fails', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      // Fail the git clone exec by matching on the Cmd prefix, so the test
      // stays valid even if new pre-flight execs are added to cloneInContainer.
      mockContainerExec.mockImplementation(async (opts: { Cmd: string[] }) => {
        const isClone = opts.Cmd[0] === 'git' && opts.Cmd[1] === 'clone'
        return {
          start: async () => ({
            on(event: string, cb: (d?: Buffer) => void) {
              if (event === 'data' && isClone) {
                setImmediate(() => cb(Buffer.from('fatal: auth')))
              }
              if (event === 'end') setImmediate(() => cb())
              return this
            }
          }),
          inspect: async () => ({ ExitCode: isClone ? 128 : 0 })
        }
      })
      await expect(createWindow('test', projectId)).rejects.toThrow()
      expect(mockStop).toHaveBeenCalled()
      expect(mockRemove).toHaveBeenCalledWith(expect.objectContaining({ force: true }))
    })

    it('removes the container if container.start fails', async () => {
      const projectId = seedProject('git@github.com:org/my-repo.git')
      const failingRemove = vi.fn().mockResolvedValue(undefined)
      mockCreateContainer.mockResolvedValueOnce({
        ...mockContainer,
        remove: failingRemove,
        start: vi.fn().mockRejectedValue(new Error('docker daemon unreachable'))
      })
      await expect(createWindow('boom', projectId)).rejects.toThrow('docker daemon unreachable')
      expect(failingRemove).toHaveBeenCalledWith(expect.objectContaining({ force: true }))
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
      await createWindow('progress', projectId, false, (s) => steps.push(s))
      expect(steps).toEqual([
        expect.stringMatching(/probing/i),
        expect.stringMatching(/starting/i),
        expect.stringMatching(/preparing/i),
        expect.stringMatching(/cloning/i),
        expect.stringMatching(/checking out/i),
        expect.stringMatching(/finaliz/i)
      ])
    })

    it('passes ExposedPorts and PortBindings when project has ports (ephemeral)', async () => {
      const projectId = seedProject('git@github.com:org/ports-repo.git', 'ports', [
        { container: 3000 },
        { container: 8080 }
      ])
      mockInspect.mockResolvedValueOnce({
        State: { Status: 'running' },
        NetworkSettings: {
          Ports: {
            '3000/tcp': [{ HostPort: '54321' }],
            '8080/tcp': [{ HostPort: '54322' }]
          }
        }
      })

      await createWindow('port-window', projectId)

      expect(mockCreateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          ExposedPorts: { '3000/tcp': {}, '8080/tcp': {} },
          HostConfig: {
            PortBindings: {
              '3000/tcp': [{ HostPort: '' }],
              '8080/tcp': [{ HostPort: '' }]
            }
          }
        })
      )
    })

    it('passes fixed HostPort when host port is specified in mapping', async () => {
      const projectId = seedProject('git@github.com:org/fixed-port-repo.git', 'fixed', [
        { container: 3000, host: 9000 }
      ])
      mockInspect.mockResolvedValueOnce({
        State: { Status: 'running' },
        NetworkSettings: {
          Ports: { '3000/tcp': [{ HostPort: '9000' }] }
        }
      })

      await createWindow('fixed-port-window', projectId)

      expect(mockCreateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          ExposedPorts: { '3000/tcp': {} },
          HostConfig: {
            PortBindings: {
              '3000/tcp': [{ HostPort: '9000' }]
            }
          }
        })
      )
    })

    it('stores the host port mapping on the window record', async () => {
      const projectId = seedProject('git@github.com:org/ports-repo2.git', 'ports2', [{ container: 3000 }])
      mockInspect.mockResolvedValueOnce({
        State: { Status: 'running' },
        NetworkSettings: {
          Ports: {
            '3000/tcp': [{ HostPort: '54321' }]
          }
        }
      })

      const win = await createWindow('port-window2', projectId)

      expect(win.ports).toBe(JSON.stringify({ '3000': '54321' }))
      const row = getDb()
        .prepare('SELECT ports FROM windows WHERE id = ?')
        .get(win.id) as { ports: string | null }
      expect(row.ports).toBe(JSON.stringify({ '3000': '54321' }))
    })

    it('does not set ExposedPorts when project has no ports', async () => {
      const projectId = seedProject('git@github.com:org/no-ports-repo.git')
      await createWindow('no-ports-window', projectId)
      expect(mockCreateContainer).toHaveBeenCalledWith(
        expect.not.objectContaining({ ExposedPorts: expect.anything() })
      )
    })

    it('injects project env vars into container Env array', async () => {
      const projectId = seedProject(
        'git@github.com:org/env-repo.git',
        'env-test',
        undefined,
        { MY_VAR: 'hello', ANOTHER: 'world' }
      )
      await createWindow('test', projectId)
      expect(mockCreateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: expect.arrayContaining([
            'CLAUDE_CODE_OAUTH_TOKEN=claude-oauth-token',
            'MY_VAR=hello',
            'ANOTHER=world'
          ])
        })
      )
    })

    it('creates container with only CLAUDE_CODE_OAUTH_TOKEN when no env vars set', async () => {
      const projectId = seedProject('git@github.com:org/no-env.git')
      await createWindow('test', projectId)
      expect(mockCreateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: ['CLAUDE_CODE_OAUTH_TOKEN=claude-oauth-token']
        })
      )
    })

    it('listWindows includes ports from the database', async () => {
      const projectId = seedProject('git@github.com:org/list-ports-repo.git', 'lp', [{ container: 4000 }])
      mockInspect.mockResolvedValueOnce({
        State: { Status: 'running' },
        NetworkSettings: { Ports: { '4000/tcp': [{ HostPort: '55000' }] } }
      })
      await createWindow('list-ports-win', projectId)
      const windows = listWindows()
      expect(windows[0].ports).toBe(JSON.stringify({ '4000': '55000' }))
    })

    it('stores null ports when container has no NetworkSettings', async () => {
      const projectId = seedProject('git@github.com:org/no-net-repo.git', 'no-net', [{ container: 3000 }])
      mockInspect.mockResolvedValueOnce({
        State: { Status: 'running' }
        // no NetworkSettings
      })

      const win = await createWindow('no-net-win', projectId)

      expect(win.ports).toBeUndefined()
      const row = getDb()
        .prepare('SELECT ports FROM windows WHERE id = ?')
        .get(win.id) as { ports: string | null }
      expect(row.ports).toBeNull()
    })

    it('continues window creation when port inspection fails', async () => {
      const projectId = seedProject('git@github.com:org/inspect-fail.git', 'if', [{ container: 3000 }])
      mockInspect.mockRejectedValueOnce(new Error('docker API timeout'))

      const win = await createWindow('inspect-fail-win', projectId)

      expect(win.ports).toBeUndefined()
      expect(win.container_id).toBe('mock-container-abc123')
      const row = getDb()
        .prepare('SELECT ports FROM windows WHERE id = ?')
        .get(win.id) as { ports: string | null }
      expect(row.ports).toBeNull()
    })

    it('throws a descriptive error when env_vars JSON is malformed', async () => {
      const projectId = seedProject('git@github.com:org/bad-env.git')
      getDb().prepare('UPDATE projects SET env_vars = ? WHERE id = ?').run('not-json', projectId)
      await expect(createWindow('test', projectId)).rejects.toThrow('malformed env_vars JSON')
    })

    it('accepts projectIds array and writes window_projects rows', async () => {
      const projectId1 = seedProject('git@github.com:org/repo-a.git', 'a')
      const projectId2 = seedProject('git@github.com:org/repo-b.git', 'b')
      const result = await createWindow('multi-win', [projectId1, projectId2])
      expect(result.project_id).toBeNull()
      expect(result.projects).toHaveLength(2)
      expect(result.projects.map(p => p.project_id).sort()).toEqual([projectId1, projectId2].sort())
    })

    it('single-project array sets project_id on window', async () => {
      const projectId = seedProject('git@github.com:org/repo.git')
      const result = await createWindow('solo-win', [projectId])
      expect(result.project_id).toBe(projectId)
      expect(result.projects).toHaveLength(1)
      expect(result.projects[0].clone_path).toBe('/workspace/repo')
    })

    it('writes window_projects with correct clone_path per project', async () => {
      const projectId = seedProject('git@github.com:org/my-project.git')
      const result = await createWindow('win', [projectId])
      expect(result.projects[0].clone_path).toBe('/workspace/my-project')
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

    it('includes projects array in each window record', async () => {
      const projectId = seedProject('git@github.com:org/list-repo.git')
      await createWindow('list-win', [projectId])
      const wins = listWindows(projectId)
      expect(wins[0].projects).toHaveLength(1)
      expect(wins[0].projects[0].project_id).toBe(projectId)
      expect(wins[0].projects[0].clone_path).toBe('/workspace/list-repo')
    })

    it('listWindows returns projects[] on multi-project window', async () => {
      const p1 = seedProject('git@github.com:org/aa.git', 'aa')
      const p2 = seedProject('git@github.com:org/bb.git', 'bb')
      await createWindow('multi', [p1, p2])
      const wins = listWindows()
      const win = wins.find(w => w.name === 'multi')
      expect(win).toBeDefined()
      expect(win!.projects).toHaveLength(2)
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
