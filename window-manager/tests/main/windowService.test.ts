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

    it('throws when window id does not exist', async () => {
      await expect(deleteWindow(99999)).rejects.toThrow('Window 99999 not found')
    })

    it('calls closeTerminalSessionFor with the container_id', async () => {
      await createWindow('with-terminal')
      const [win] = listWindows()
      await deleteWindow(win.id)
      expect(mockCloseTerminalSessionFor).toHaveBeenCalledWith('mock-container-abc123')
    })
  })
})
