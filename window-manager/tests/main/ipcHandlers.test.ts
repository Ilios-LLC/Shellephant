import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
}))

vi.mock('../../src/main/windowService', () => ({
  createWindow: vi.fn(),
  listWindows: vi.fn(),
  deleteWindow: vi.fn(),
}))

vi.mock('../../src/main/terminalService', () => ({
  openTerminal: vi.fn(),
  writeInput: vi.fn(),
  resizeTerminal: vi.fn(),
  closeTerminal: vi.fn(),
}))

import { ipcMain, BrowserWindow } from 'electron'
import {
  createWindow,
  listWindows,
  deleteWindow,
} from '../../src/main/windowService'
import {
  openTerminal,
  writeInput,
  resizeTerminal,
  closeTerminal,
} from '../../src/main/terminalService'
import { registerIpcHandlers } from '../../src/main/ipcHandlers'

const mockWin = { webContents: {} } as any

function getHandler(channel: string) {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const call = calls.find(c => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: any[]) => any
}

function getListener(channel: string) {
  const calls = vi.mocked(ipcMain.on).mock.calls
  const call = calls.find(c => c[0] === channel)
  if (!call) throw new Error(`No listener registered for ${channel}`)
  return call[1] as (...args: any[]) => any
}

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerIpcHandlers()
  })

  it('registers window:create handler that calls createWindow', async () => {
    const record = { id: 1, name: 'test', container_id: 'abc', created_at: '2026-01-01', status: 'running' as const }
    vi.mocked(createWindow).mockResolvedValue(record)
    const result = await getHandler('window:create')({}, 'test')
    expect(createWindow).toHaveBeenCalledWith('test')
    expect(result).toEqual(record)
  })

  it('registers window:list handler that calls listWindows', async () => {
    const records = [{ id: 1, name: 'w', container_id: 'x', created_at: '2026-01-01', status: 'running' as const }]
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
    await getHandler('terminal:open')({ sender: {} }, 'container-abc')
    expect(openTerminal).toHaveBeenCalledWith('container-abc', mockWin)
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
})
