import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { mockSpawn, mockWrite, mockResize, mockKill, mockOnData, mockOnExit } = vi.hoisted(() => {
  return {
    mockSpawn: vi.fn(),
    mockWrite: vi.fn(),
    mockResize: vi.fn(),
    mockKill: vi.fn(),
    mockOnData: vi.fn(),
    mockOnExit: vi.fn()
  }
})

vi.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args)
}))

const { mockGetClaudeToken } = vi.hoisted(() => ({ mockGetClaudeToken: vi.fn() }))
vi.mock('../../src/main/settingsService', () => ({
  getClaudeToken: () => mockGetClaudeToken()
}))

const { mockGetContainer, mockExecInContainer } = vi.hoisted(() => ({
  mockGetContainer: vi.fn(),
  mockExecInContainer: vi.fn()
}))
vi.mock('../../src/main/docker', () => ({
  getDocker: () => ({ getContainer: (id: string) => mockGetContainer(id) })
}))
vi.mock('../../src/main/gitOps', () => ({
  execInContainer: (...args: unknown[]) => mockExecInContainer(...args)
}))

import {
  openTerminal,
  writeInput,
  resizeTerminal,
  closeTerminal,
  closeTerminalSessionFor,
  getSession
} from '../../src/main/terminalService'

type DataHandler = (data: string) => void
type ExitHandler = () => void

function makeFakePty() {
  let dataHandler: DataHandler | null = null
  let exitHandler: ExitHandler | null = null
  const pty = {
    write: mockWrite,
    resize: mockResize,
    kill: mockKill,
    onData: (cb: DataHandler) => {
      dataHandler = cb
      mockOnData(cb)
    },
    onExit: (cb: ExitHandler) => {
      exitHandler = cb
      mockOnExit(cb)
    },
    emitData: (s: string) => dataHandler?.(s),
    emitExit: () => exitHandler?.()
  }
  return pty
}

function makeFakeWin(isDestroyed = false) {
  return {
    isDestroyed: vi.fn().mockReturnValue(isDestroyed),
    webContents: { send: vi.fn() }
  } as unknown as {
    isDestroyed: ReturnType<typeof vi.fn>
    webContents: { send: ReturnType<typeof vi.fn> }
  }
}

describe('terminalService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockGetClaudeToken.mockReturnValue(null)
    mockGetContainer.mockReturnValue({})
    mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function openAndSettle(
    containerId: string,
    win: ReturnType<typeof makeFakeWin>,
    cols: number,
    rows: number,
    displayName: string = ''
  ): Promise<void> {
    await openTerminal(containerId, win as any, cols, rows, displayName)
    await vi.advanceTimersByTimeAsync(400)
  }

  describe('openTerminal', () => {
    it('spawns docker exec -it under a node-pty with the given cols/rows', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-1', win as any, 120, 40)

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      const [program, args, opts] = mockSpawn.mock.calls[0] as [
        string,
        string[],
        { cols: number; rows: number; name: string }
      ]
      expect(program).toBe('docker')
      expect(args).toContain('exec')
      expect(args).toContain('-i')
      expect(args).toContain('-t')
      expect(args).toContain('TERM=xterm-256color')
      expect(args).toContain('LANG=C.UTF-8')
      expect(args).toContain('LC_ALL=C.UTF-8')
      expect(args).toContain('container-1')
      expect(args).toContain('sh')
      expect(args).toContain('-c')
      expect(args.join(' ')).toMatch(/tmux -u new-session -A -s cw/)
      expect(opts.cols).toBe(120)
      expect(opts.rows).toBe(40)
      expect(opts.name).toBe('xterm-256color')
    })

    it('fires a stale-marker cleanup exec on open', async () => {
      mockSpawn.mockReturnValueOnce(makeFakePty())
      await openTerminal('container-stale', makeFakeWin() as any, 80, 24)
      // Fire-and-forget — wait a tick for the promise chain to settle.
      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
      expect(mockGetContainer).toHaveBeenCalledWith('container-stale')
      const cmd = mockExecInContainer.mock.calls[0]?.[1] as string[]
      expect(cmd).toEqual(['rm', '-f', '/tmp/claude-waiting'])
    })

    it('swallows errors from the stale-marker cleanup', async () => {
      mockSpawn.mockReturnValueOnce(makeFakePty())
      mockExecInContainer.mockRejectedValueOnce(new Error('docker down'))
      await expect(
        openTerminal('container-stale-err', makeFakeWin() as any, 80, 24)
      ).resolves.toBeUndefined()
    })

    it('clamps non-positive cols/rows to 1', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-clamp', win as any, 0, -5)

      const opts = mockSpawn.mock.calls[0][2] as { cols: number; rows: number }
      expect(opts.cols).toBe(1)
      expect(opts.rows).toBe(1)
    })

    it('forwards pty data immediately (no boot-settle swallow)', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openTerminal('container-boot', win as any, 80, 24)
      ptyInstance.emitData('hello')
      expect(win.webContents.send).toHaveBeenCalledWith(
        'terminal:data',
        'container-boot',
        'hello'
      )
    })

    it('forwards pty data after the settle window opens passthrough', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openAndSettle('container-2', win, 80, 24)
      ptyInstance.emitData('hello')

      expect(win.webContents.send).toHaveBeenCalledWith('terminal:data', 'container-2', 'hello')
    })

    it('kicks tmux with a size-bump SIGWINCH when the settle elapses', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openAndSettle('container-kick', win, 80, 24)

      expect(mockResize).toHaveBeenCalledWith(80, 23)
      expect(mockResize).toHaveBeenCalledWith(80, 24)
    })

    it('does not forward data when the window is destroyed', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin(true)

      await openAndSettle('container-destroyed', win, 80, 24)
      ptyInstance.emitData('ignored')

      expect(win.webContents.send).not.toHaveBeenCalled()
    })

    it('emits [detached] on pty exit and clears the session', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      const win = makeFakeWin()

      await openAndSettle('container-exit', win, 80, 24)
      ptyInstance.emitExit()

      expect(win.webContents.send).toHaveBeenCalledWith(
        'terminal:data',
        'container-exit',
        '\r\n[detached]\r\n'
      )

      writeInput('container-exit', 'x')
      expect(mockWrite).not.toHaveBeenCalled()
    })

    it('is idempotent: a second open kills the previous pty first', async () => {
      const p1 = makeFakePty()
      const p2 = makeFakePty()
      mockSpawn.mockReturnValueOnce(p1).mockReturnValueOnce(p2)
      const win = makeFakeWin()

      await openAndSettle('container-idem', win, 80, 24)
      await openAndSettle('container-idem', win, 80, 24)

      expect(mockKill).toHaveBeenCalledTimes(1)
      expect(mockSpawn).toHaveBeenCalledTimes(2)
    })
  })

  describe('getSession', () => {
    it('returns the session for the given containerId', async () => {
      mockSpawn.mockReturnValueOnce(makeFakePty())
      const win = makeFakeWin()
      await openAndSettle('container-gs', win, 80, 24, 'my-name')
      const s = getSession('container-gs')
      expect(s?.displayName).toBe('my-name')
      expect(s?.win).toBe(win)
    })

    it('returns undefined for an unknown containerId', () => {
      expect(getSession('nope')).toBeUndefined()
    })
  })


  describe('writeInput', () => {
    it('writes to the right session pty', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-w', makeFakeWin(), 80, 24)
      writeInput('container-w', 'ls\n')
      expect(mockWrite).toHaveBeenCalledWith('ls\n')
    })

    it('is a no-op when no session exists', () => {
      expect(() => writeInput('missing', 'x')).not.toThrow()
      expect(mockWrite).not.toHaveBeenCalled()
    })
  })

  describe('resizeTerminal', () => {
    it('debounces rapid resizes into a single pty.resize with the last size', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-r', makeFakeWin(), 80, 24)
      mockResize.mockClear()

      resizeTerminal('container-r', 100, 30)
      resizeTerminal('container-r', 110, 35)
      resizeTerminal('container-r', 132, 43)

      expect(mockResize).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(200)

      expect(mockResize).toHaveBeenCalledTimes(1)
      expect(mockResize).toHaveBeenCalledWith(132, 43)
    })

    it('clamps non-positive resize args to 1', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-clamp2', makeFakeWin(), 80, 24)
      mockResize.mockClear()

      resizeTerminal('container-clamp2', 0, -5)
      await vi.advanceTimersByTimeAsync(200)

      expect(mockResize).toHaveBeenCalledWith(1, 1)
    })

    it('is a no-op when no session exists', async () => {
      resizeTerminal('missing', 80, 24)
      await vi.advanceTimersByTimeAsync(200)
      expect(mockResize).not.toHaveBeenCalled()
    })
  })

  describe('closeTerminal', () => {
    it('kills the pty and drops the session', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-c', makeFakeWin(), 80, 24)

      closeTerminal('container-c')

      expect(mockKill).toHaveBeenCalled()
      writeInput('container-c', 'x')
      expect(mockWrite).not.toHaveBeenCalled()
    })

    it('is a no-op when no session exists', () => {
      expect(() => closeTerminal('ghost')).not.toThrow()
      expect(mockKill).not.toHaveBeenCalled()
    })

    it('does not throw when pty.kill rejects', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-throwy', makeFakeWin(), 80, 24)
      mockKill.mockImplementationOnce(() => {
        throw new Error('already dead')
      })
      expect(() => closeTerminal('container-throwy')).not.toThrow()
    })
  })

  describe('closeTerminalSessionFor', () => {
    it('behaves identically to closeTerminal', async () => {
      const ptyInstance = makeFakePty()
      mockSpawn.mockReturnValueOnce(ptyInstance)
      await openAndSettle('container-csf', makeFakeWin(), 80, 24)
      closeTerminalSessionFor('container-csf')
      expect(mockKill).toHaveBeenCalled()
    })
  })
})
