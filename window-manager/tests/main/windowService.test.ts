import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

const mockStart = vi.fn().mockResolvedValue(undefined)
const mockStop = vi.fn().mockResolvedValue(undefined)
const mockContainer = {
  id: 'mock-container-abc123',
  start: mockStart,
  stop: mockStop,
}
const mockCreateContainer = vi.fn().mockResolvedValue(mockContainer)
const mockGetContainer = vi.fn().mockReturnValue(mockContainer)

vi.mock('dockerode', () => ({
  default: vi.fn(function () {
    return {
      createContainer: mockCreateContainer,
      getContainer: mockGetContainer,
    }
  })
}))

const { mockCloseTerminalSessionFor } = vi.hoisted(() => ({
  mockCloseTerminalSessionFor: vi.fn(),
}))

vi.mock('../../src/main/terminalService', () => ({
  closeTerminalSessionFor: mockCloseTerminalSessionFor,
}))

import { createWindow, listWindows, deleteWindow } from '../../src/main/windowService'

describe('windowService', () => {
  beforeEach(() => {
    initDb(':memory:')
    vi.clearAllMocks()
    mockStart.mockResolvedValue(undefined)
    mockStop.mockResolvedValue(undefined)
    mockCreateContainer.mockResolvedValue(mockContainer)
    mockGetContainer.mockReturnValue(mockContainer)
  })

  afterEach(() => {
    closeDb()
  })

  describe('createWindow', () => {
    it('returns a record with the given name and container_id', async () => {
      const result = await createWindow('my-window')
      expect(result.name).toBe('my-window')
      expect(result.container_id).toBe('mock-container-abc123')
      expect(result.id).toBeTypeOf('number')
      expect(result.created_at).toBeTypeOf('string')
    })

    it('creates a Docker container from the cc image', async () => {
      await createWindow('test')
      expect(mockCreateContainer).toHaveBeenCalledWith(
        expect.objectContaining({ Image: 'cc' })
      )
    })

    it('starts the container', async () => {
      await createWindow('test')
      expect(mockStart).toHaveBeenCalled()
    })

    it('persists the window to SQLite', async () => {
      await createWindow('persisted')
      expect(listWindows()).toHaveLength(1)
      expect(listWindows()[0].name).toBe('persisted')
    })
  })

  describe('listWindows', () => {
    it('returns empty array when no windows exist', () => {
      expect(listWindows()).toEqual([])
    })

    it('excludes soft-deleted windows', async () => {
      await createWindow('active')
      await createWindow('to-delete')
      const id = listWindows().find(w => w.name === 'to-delete')!.id
      await deleteWindow(id)
      const result = listWindows()
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('active')
    })
  })

  describe('deleteWindow', () => {
    it('sets deleted_at in the database', async () => {
      await createWindow('to-delete')
      const [win] = listWindows()
      await deleteWindow(win.id)
      const row = getDb()
        .prepare('SELECT deleted_at FROM windows WHERE id = ?')
        .get(win.id) as { deleted_at: string | null }
      expect(row.deleted_at).not.toBeNull()
    })

    it('stops the Docker container', async () => {
      await createWindow('to-stop')
      const [win] = listWindows()
      await deleteWindow(win.id)
      expect(mockStop).toHaveBeenCalled()
    })

    it('returns silently when the window id does not exist', async () => {
      await expect(deleteWindow(99999)).resolves.toBeUndefined()
    })

    it('does not throw when deleted twice in a row', async () => {
      await createWindow('twice')
      const [win] = listWindows()
      await deleteWindow(win.id)
      await expect(deleteWindow(win.id)).resolves.toBeUndefined()
    })

    it('does not throw when container.stop rejects', async () => {
      await createWindow('already-stopped')
      const [win] = listWindows()
      mockStop.mockRejectedValueOnce(new Error('already stopped'))
      await expect(deleteWindow(win.id)).resolves.toBeUndefined()
    })

    it('clears the statusMap entry for the deleted window', async () => {
      await createWindow('vanish')
      const [win] = listWindows()
      expect(listWindows()[0].status).toBe('running')
      await deleteWindow(win.id)
      getDb()
        .prepare('INSERT INTO windows (name, container_id) VALUES (?, ?)')
        .run('probe', 'probe-container')
      const probe = listWindows().find(r => r.name === 'probe')!
      expect(probe.status).toBe('unknown')
    })

    it('calls closeTerminalSessionFor with the container_id', async () => {
      await createWindow('with-terminal')
      const [win] = listWindows()
      await deleteWindow(win.id)
      expect(mockCloseTerminalSessionFor).toHaveBeenCalledWith('mock-container-abc123')
    })
  })
})
