import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startDepLogs, stopDepLogs, stopAllDepLogs } from '../../src/main/depLogsService'

function makeStream(chunks: string[]) {
  return {
    on: vi.fn((event: string, cb: (data: Buffer) => void) => {
      if (event === 'data') {
        for (const chunk of chunks) cb(Buffer.from(chunk))
      }
      return { on: vi.fn() }
    }),
    destroy: vi.fn()
  }
}

function makeContainer(stream: ReturnType<typeof makeStream>) {
  return {
    logs: vi.fn().mockResolvedValue(stream)
  }
}

describe('depLogsService', () => {
  beforeEach(() => stopAllDepLogs())

  it('calls onData for each streamed chunk', async () => {
    const stream = makeStream(['hello', ' world'])
    const container = makeContainer(stream)
    const onData = vi.fn()
    await startDepLogs('c1', container as never, onData)
    expect(onData).toHaveBeenCalledWith('hello')
    expect(onData).toHaveBeenCalledWith(' world')
  })

  it('stopDepLogs destroys the stream', async () => {
    const stream = makeStream([])
    const container = makeContainer(stream)
    await startDepLogs('c2', container as never, vi.fn())
    stopDepLogs('c2')
    expect(stream.destroy).toHaveBeenCalled()
  })

  it('stopAllDepLogs destroys all active streams', async () => {
    const s1 = makeStream([])
    const s2 = makeStream([])
    await startDepLogs('c3', makeContainer(s1) as never, vi.fn())
    await startDepLogs('c4', makeContainer(s2) as never, vi.fn())
    stopAllDepLogs()
    expect(s1.destroy).toHaveBeenCalled()
    expect(s2.destroy).toHaveBeenCalled()
  })

  it('stopDepLogs is a no-op for unknown containerId', () => {
    expect(() => stopDepLogs('unknown')).not.toThrow()
  })
})
