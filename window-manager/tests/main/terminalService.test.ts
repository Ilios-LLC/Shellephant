import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'

const { mockExecStart, mockExecResize, mockExec, mockContainerExec, mockGetContainer } = vi.hoisted(() => {
  const mockExecStart = vi.fn()
  const mockExecResize = vi.fn().mockResolvedValue(undefined)
  const mockExec = {
    start: mockExecStart,
    resize: mockExecResize,
  }
  const mockContainerExec = vi.fn().mockResolvedValue(mockExec)
  const mockGetContainer = vi.fn().mockReturnValue({ exec: mockContainerExec })
  return { mockExecStart, mockExecResize, mockExec, mockContainerExec, mockGetContainer }
})

vi.mock('dockerode', () => ({
  default: vi.fn(function () {
    return { getContainer: mockGetContainer }
  })
}))

import {
  openTerminal,
  writeInput,
  resizeTerminal,
  closeTerminal,
  closeTerminalSessionFor,
} from '../../src/main/terminalService'

function makeFakeStream(): EventEmitter & { write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> } {
  const stream = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  stream.write = vi.fn()
  stream.destroy = vi.fn()
  return stream
}

function makeFakeWin(isDestroyed = false) {
  return {
    isDestroyed: vi.fn().mockReturnValue(isDestroyed),
    webContents: { send: vi.fn() },
  } as unknown as {
    isDestroyed: ReturnType<typeof vi.fn>
    webContents: { send: ReturnType<typeof vi.fn> }
  }
}

describe('terminalService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecResize.mockResolvedValue(undefined)
  })

  describe('openTerminal', () => {
    it('calls container.exec with tmux new-session -A -s cw and TERM=xterm-256color', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      const win = makeFakeWin()

      await openTerminal('container-1', win as any)

      expect(mockGetContainer).toHaveBeenCalledWith('container-1')
      expect(mockContainerExec).toHaveBeenCalledWith(
        expect.objectContaining({
          Cmd: ['tmux', 'new-session', '-A', '-s', 'cw'],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
          Env: ['TERM=xterm-256color'],
        })
      )
      expect(mockExecStart).toHaveBeenCalledWith({ hijack: true, stdin: true })
    })

    it('forwards stream data to win.webContents.send on terminal:data channel', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      const win = makeFakeWin()

      await openTerminal('container-2', win as any)
      stream.emit('data', Buffer.from('hello'))

      expect(win.webContents.send).toHaveBeenCalledWith('terminal:data', 'container-2', 'hello')
    })

    it('does not call webContents.send when win.isDestroyed() is true', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      const win = makeFakeWin(true)

      await openTerminal('container-3', win as any)
      stream.emit('data', Buffer.from('ignored'))

      expect(win.webContents.send).not.toHaveBeenCalled()
    })

    it('is idempotent: a second open for the same container closes the previous session first', async () => {
      const stream1 = makeFakeStream()
      const stream2 = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream1).mockResolvedValueOnce(stream2)
      const win = makeFakeWin()

      await openTerminal('container-4', win as any)
      await openTerminal('container-4', win as any)

      expect(stream1.destroy).toHaveBeenCalled()
      expect(mockContainerExec).toHaveBeenCalledTimes(2)
    })

    it('cleans up the session when the stream ends', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      const win = makeFakeWin()

      await openTerminal('container-5', win as any)
      stream.emit('end')

      // Re-opening should now create a fresh exec (not close a prior session since it's gone).
      const stream2 = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream2)
      await openTerminal('container-5', win as any)
      expect(mockContainerExec).toHaveBeenCalledTimes(2)
      // The original stream should not have had destroy called twice
      expect(stream.destroy).not.toHaveBeenCalled()
    })
  })

  describe('writeInput', () => {
    it('writes input to the right session stream', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      await openTerminal('container-write', makeFakeWin() as any)
      writeInput('container-write', 'ls\n')
      expect(stream.write).toHaveBeenCalledWith('ls\n')
    })

    it('is a no-op when no session exists', () => {
      expect(() => writeInput('missing', 'x')).not.toThrow()
    })
  })

  describe('resizeTerminal', () => {
    it('calls exec.resize with cols and rows mapped to w/h', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      await openTerminal('container-resize', makeFakeWin() as any)
      await resizeTerminal('container-resize', 80, 24)
      expect(mockExecResize).toHaveBeenCalledWith({ w: 80, h: 24 })
    })
  })

  describe('closeTerminal', () => {
    it('destroys the stream and clears the session', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      await openTerminal('container-close', makeFakeWin() as any)
      closeTerminal('container-close')
      expect(stream.destroy).toHaveBeenCalled()
    })
  })

  describe('closeTerminalSessionFor', () => {
    it('behaves identically to closeTerminal', async () => {
      const stream = makeFakeStream()
      mockExecStart.mockResolvedValueOnce(stream)
      await openTerminal('container-csf', makeFakeWin() as any)
      closeTerminalSessionFor('container-csf')
      expect(stream.destroy).toHaveBeenCalled()
    })

    it('is a no-op when no session exists', () => {
      expect(() => closeTerminalSessionFor('ghost')).not.toThrow()
    })
  })
})
