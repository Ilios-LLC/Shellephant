import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockDbAll, mockExecInContainer, mockDispatchWaiting, mockDispatchSummary, mockGetContainer } = vi.hoisted(
  () => ({
    mockDbAll: vi.fn(),
    mockExecInContainer: vi.fn(),
    mockDispatchWaiting: vi.fn(),
    mockDispatchSummary: vi.fn(),
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
vi.mock('../../src/main/summaryDispatcher', () => ({
  dispatchSummary: (...args: unknown[]) => mockDispatchSummary(...args)
}))
vi.mock('../../src/main/docker', () => ({
  getDocker: () => ({ getContainer: (id: string) => mockGetContainer(id) })
}))

function setContainers(ids: string[]): void {
  mockDbAll.mockReturnValue(ids.map((container_id) => ({ container_id })))
}

// Helper: set up exec to return waiting=Y on first call, empty summary on second
function waitingYesNoSummary(): void {
  mockExecInContainer
    .mockResolvedValueOnce({ ok: true, code: 0, stdout: 'Y\r\n' })  // waiting check
    .mockResolvedValueOnce({ ok: true, code: 0, stdout: '' })         // summary check
}

// Helper: set up exec for both calls returning empty (no dispatch)
function bothEmpty(): void {
  mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
}

import { pollOnce, startWaitingPoller } from '../../src/main/waitingPoller'

describe('waitingPoller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetContainer.mockImplementation((id: string) => ({ id }))
  })

  describe('pollOnce', () => {
    it('dispatches waiting when exec returns Y on first call', async () => {
      setContainers(['cid-a'])
      waitingYesNoSummary()
      await pollOnce()
      expect(mockDispatchWaiting).toHaveBeenCalledWith('cid-a')
    })

    it('does not dispatch waiting on empty stdout', async () => {
      setContainers(['cid-empty'])
      bothEmpty()
      await pollOnce()
      expect(mockDispatchWaiting).not.toHaveBeenCalled()
    })

    it('does not dispatch waiting when exec fails', async () => {
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

    it('polls every active container — 2 exec calls per container', async () => {
      setContainers(['c1', 'c2', 'c3'])
      bothEmpty()
      await pollOnce()
      // 2 exec calls per container (waiting + summary) × 3 containers = 6
      expect(mockExecInContainer).toHaveBeenCalledTimes(6)
    })

    it('uses the exact waiting probe command on first call', async () => {
      setContainers(['cid-cmd'])
      bothEmpty()
      await pollOnce()
      const cmd = mockExecInContainer.mock.calls[0][1] as string[]
      expect(cmd[0]).toBe('sh')
      expect(cmd[1]).toBe('-c')
      expect(cmd[2]).toBe('test -e /tmp/claude-waiting && rm -f /tmp/claude-waiting && echo Y')
    })

    it('uses the exact summary probe command on second call', async () => {
      setContainers(['cid-cmd'])
      bothEmpty()
      await pollOnce()
      const cmd = mockExecInContainer.mock.calls[1][1] as string[]
      expect(cmd[0]).toBe('sh')
      expect(cmd[1]).toBe('-c')
      expect(cmd[2]).toBe(
        'test -f /tmp/claude-summary.json && cat /tmp/claude-summary.json && rm -f /tmp/claude-summary.json'
      )
    })

    it('skips polling when no sessions are active', async () => {
      setContainers([])
      await pollOnce()
      expect(mockExecInContainer).not.toHaveBeenCalled()
    })

    it('dispatches summary when summary file contains valid JSON', async () => {
      setContainers(['cid-summary'])
      const json = JSON.stringify({ title: 'Built login', bullets: ['added form', 'tests pass'] })
      mockExecInContainer
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: '' })           // waiting check
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: json })          // summary check
      await pollOnce()
      expect(mockDispatchSummary).toHaveBeenCalledWith('cid-summary', {
        title: 'Built login',
        bullets: ['added form', 'tests pass']
      })
    })

    it('does not dispatch summary when stdout is empty', async () => {
      setContainers(['cid-nosummary'])
      bothEmpty()
      await pollOnce()
      expect(mockDispatchSummary).not.toHaveBeenCalled()
    })

    it('silently ignores malformed summary JSON', async () => {
      setContainers(['cid-bad'])
      mockExecInContainer
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: '' })
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: 'not-json' })
      await expect(pollOnce()).resolves.toBeUndefined()
      expect(mockDispatchSummary).not.toHaveBeenCalled()
    })

    it('silently ignores summary JSON missing required fields', async () => {
      setContainers(['cid-incomplete'])
      mockExecInContainer
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: '' })
        .mockResolvedValueOnce({ ok: true, code: 0, stdout: JSON.stringify({ title: 'hi' }) })
      await pollOnce()
      expect(mockDispatchSummary).not.toHaveBeenCalled()
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

    it('fires pollOnce on each 3s tick (2 exec calls per container per tick)', async () => {
      vi.useFakeTimers()
      setContainers(['tick-cid'])
      bothEmpty()
      const stop = startWaitingPoller()
      try {
        await Promise.resolve()
        mockExecInContainer.mockClear()
        await vi.advanceTimersByTimeAsync(3000)
        expect(mockExecInContainer).toHaveBeenCalledTimes(2) // 2 per container × 1 container
        await vi.advanceTimersByTimeAsync(3000)
        expect(mockExecInContainer).toHaveBeenCalledTimes(4)
      } finally {
        stop()
        vi.useRealTimers()
      }
    })

    it('primes markers at boot (clears stale /tmp/claude-waiting)', async () => {
      vi.useFakeTimers()
      setContainers(['boot-cid'])
      bothEmpty()
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
