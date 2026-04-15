import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockDbAll, mockExecInContainer, mockDispatchWaiting, mockGetContainer } = vi.hoisted(
  () => ({
    mockDbAll: vi.fn(),
    mockExecInContainer: vi.fn(),
    mockDispatchWaiting: vi.fn(),
    mockGetContainer: vi.fn()
  })
)

vi.mock('../../src/main/db', () => ({
  getDb: () => ({ prepare: () => ({ all: () => mockDbAll() }) })
}))
vi.mock('../../src/main/gitOps', () => ({
  execInContainer: (...args: unknown[]) => mockExecInContainer(...args)
}))
vi.mock('../../src/main/waitingDispatcher', () => ({
  dispatchWaiting: (id: string) => mockDispatchWaiting(id)
}))
vi.mock('../../src/main/docker', () => ({
  getDocker: () => ({ getContainer: (id: string) => mockGetContainer(id) })
}))

function setContainers(ids: string[]): void {
  mockDbAll.mockReturnValue(ids.map((container_id) => ({ container_id })))
}

import { pollOnce, startWaitingPoller } from '../../src/main/waitingPoller'

describe('waitingPoller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetContainer.mockImplementation((id: string) => ({ id }))
  })

  describe('pollOnce', () => {
    it('dispatches when exec returns Y', async () => {
      setContainers(['cid-a'])
      mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: 'Y\r\n' })
      await pollOnce()
      expect(mockDispatchWaiting).toHaveBeenCalledWith('cid-a')
    })

    it('does not dispatch on empty stdout', async () => {
      setContainers(['cid-empty'])
      mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
      await pollOnce()
      expect(mockDispatchWaiting).not.toHaveBeenCalled()
    })

    it('does not dispatch when exec fails', async () => {
      setContainers(['cid-fail'])
      mockExecInContainer.mockResolvedValue({ ok: false, code: 1, stdout: '' })
      await pollOnce()
      expect(mockDispatchWaiting).not.toHaveBeenCalled()
    })

    it('swallows exec rejections (container gone)', async () => {
      setContainers(['cid-missing'])
      mockExecInContainer.mockRejectedValue(new Error('no such container'))
      await expect(pollOnce()).resolves.toBeUndefined()
      expect(mockDispatchWaiting).not.toHaveBeenCalled()
    })

    it('polls every active container in parallel', async () => {
      setContainers(['c1', 'c2', 'c3'])
      mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
      await pollOnce()
      expect(mockExecInContainer).toHaveBeenCalledTimes(3)
    })

    it('uses the exact probe command', async () => {
      setContainers(['cid-cmd'])
      mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
      await pollOnce()
      const cmd = mockExecInContainer.mock.calls[0][1] as string[]
      expect(cmd[0]).toBe('sh')
      expect(cmd[1]).toBe('-c')
      expect(cmd[2]).toBe('test -e /tmp/claude-waiting && rm -f /tmp/claude-waiting && echo Y')
    })

    it('skips polling when no sessions are active', async () => {
      setContainers([])
      await pollOnce()
      expect(mockExecInContainer).not.toHaveBeenCalled()
    })
  })

  describe('startWaitingPoller', () => {
    it('returns a stop function that clears the interval', () => {
      vi.useFakeTimers()
      try {
        const stop = startWaitingPoller()
        expect(typeof stop).toBe('function')
        stop()
      } finally {
        vi.useRealTimers()
      }
    })

    it('fires pollOnce on each 3s tick', async () => {
      vi.useFakeTimers()
      setContainers(['tick-cid'])
      mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
      const stop = startWaitingPoller()
      try {
        // Swallow the boot-time primeMarkers call so we count ticks only.
        await Promise.resolve()
        mockExecInContainer.mockClear()
        await vi.advanceTimersByTimeAsync(3000)
        expect(mockExecInContainer).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(3000)
        expect(mockExecInContainer).toHaveBeenCalledTimes(2)
      } finally {
        stop()
        vi.useRealTimers()
      }
    })

    it('primes markers at boot (clears stale /tmp/claude-waiting)', async () => {
      vi.useFakeTimers()
      setContainers(['boot-cid'])
      mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
      const stop = startWaitingPoller()
      try {
        await Promise.resolve()
        await Promise.resolve()
        expect(mockExecInContainer).toHaveBeenCalledTimes(1)
        const cmd = mockExecInContainer.mock.calls[0][1] as string[]
        expect(cmd).toEqual(['rm', '-f', '/tmp/claude-waiting'])
      } finally {
        stop()
        vi.useRealTimers()
      }
    })
  })
})
