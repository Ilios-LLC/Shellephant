import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockParentPort, mockSpawn, mockCreate } = vi.hoisted(() => ({
  mockParentPort: { postMessage: vi.fn(), on: vi.fn(), once: vi.fn() },
  mockSpawn: vi.fn(),
  mockCreate: vi.fn()
}))

// Mock worker_threads parentPort
vi.mock('worker_threads', () => ({
  parentPort: mockParentPort,
  workerData: {}
}))

// Mock child_process for docker exec
vi.mock('child_process', () => ({ spawn: mockSpawn }))

// Mock openai
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } }
  }))
}))

import { resolveSystemPrompt, buildKimiTools, parseDockerOutput } from '../../src/main/assistedWindowWorker'

describe('resolveSystemPrompt', () => {
  it('returns project prompt when set', () => {
    const result = resolveSystemPrompt('project prompt', null)
    expect(result).toBe('project prompt')
  })

  it('returns global prompt when project not set', () => {
    const result = resolveSystemPrompt(null, 'global prompt')
    expect(result).toBe('global prompt')
  })

  it('returns default prompt when both null', () => {
    const result = resolveSystemPrompt(null, null)
    expect(result).toContain('autonomous coding assistant')
  })
})

describe('buildKimiTools', () => {
  it('returns array with run_claude_code and ping_user tools', () => {
    const tools = buildKimiTools()
    const names = tools.map((t: { function: { name: string } }) => t.function.name)
    expect(names).toContain('run_claude_code')
    expect(names).toContain('ping_user')
  })
})

describe('parseDockerOutput', () => {
  it('splits stdout lines and extracts session id from stderr', () => {
    const result = parseDockerOutput('line1\nline2\n', 'session-abc')
    expect(result.outputLines).toEqual(['line1', 'line2'])
    expect(result.sessionId).toBe('session-abc')
  })

  it('returns null sessionId when stderr is empty', () => {
    const result = parseDockerOutput('output', '')
    expect(result.sessionId).toBeNull()
  })
})
