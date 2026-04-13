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

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: object, cb: Function) => cb(null, '', ''))
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
import { createProject } from '../../src/main/projectService'

describe('windowService', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
    vi.clearAllMocks()
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
      const project = await createProject('test', 'git@github.com:org/repo.git')
      const result = await createWindow('my-window', project.id)
      expect(result.name).toBe('my-window')
      expect(result.project_id).toBe(project.id)
      expect(result.container_id).toBe('mock-container-abc123')
      expect(result.id).toBeTypeOf('number')
      expect(result.created_at).toBeTypeOf('string')
    })

    it('creates a Docker container from the cc image', async () => {
      const project = await createProject('test', 'git@github.com:org/repo.git')
      await createWindow('test', project.id)
      expect(mockCreateContainer).toHaveBeenCalledWith(expect.objectContaining({ Image: 'cc' }))
    })

    it('starts the container', async () => {
      const project = await createProject('test', 'git@github.com:org/repo.git')
      await createWindow('test', project.id)
      expect(mockStart).toHaveBeenCalled()
    })

    it('execs git clone inside the container', async () => {
      const project = await createProject('test', 'git@github.com:org/my-repo.git')
      await createWindow('test', project.id)
      expect(mockContainerExec).toHaveBeenCalledWith(
        expect.objectContaining({
          Cmd: ['git', 'clone', 'git@github.com:org/my-repo.git', '/workspace/my-repo']
        })
      )
    })

    it('persists the window to SQLite', async () => {
      const project = await createProject('test', 'git@github.com:org/repo.git')
      await createWindow('persisted', project.id)
      expect(listWindows()).toHaveLength(1)
      expect(listWindows()[0].name).toBe('persisted')
    })

    it('throws if project does not exist', async () => {
      await expect(createWindow('test', 99999)).rejects.toThrow('Project not found')
    })
  })

  describe('listWindows', () => {
    it('returns empty array when no windows exist', () => {
      expect(listWindows()).toEqual([])
    })

    it('excludes soft-deleted windows', async () => {
      const project = await createProject('test', 'git@github.com:org/list-repo.git')
      await createWindow('active', project.id)
      await createWindow('to-delete', project.id)
      const id = listWindows().find((w) => w.name === 'to-delete')!.id
      await deleteWindow(id)
      const result = listWindows()
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('active')
    })

    it('filters by projectId when provided', async () => {
      const p1 = await createProject('proj1', 'git@github.com:org/filter-a.git')
      const p2 = await createProject('proj2', 'git@github.com:org/filter-b.git')
      await createWindow('win-a', p1.id)
      await createWindow('win-b', p2.id)
      const filtered = listWindows(p1.id)
      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('win-a')
    })
  })

  describe('deleteWindow', () => {
    let projectId: number
    beforeEach(async () => {
      const project = await createProject('del-test', 'git@github.com:org/del-repo.git')
      projectId = project.id
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
    beforeEach(async () => {
      const project = await createProject('status-test', 'git@github.com:org/status-repo.git')
      projectId = project.id
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
    beforeEach(async () => {
      const project = await createProject('recon-test', 'git@github.com:org/recon-repo.git')
      projectId = project.id
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
