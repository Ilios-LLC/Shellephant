import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock worker constructors
const MockEditorWorker = vi.fn()
const MockTsWorker = vi.fn()
const MockJsonWorker = vi.fn()

vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: MockEditorWorker }))
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => ({ default: MockTsWorker }))
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({ default: MockJsonWorker }))

vi.mock('monaco-editor', () => ({
  default: {},
  editor: { defineTheme: vi.fn(), create: vi.fn() },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 }
}))

describe('monacoConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    delete (window as any).MonacoEnvironment
  })

  it('sets MonacoEnvironment.getWorker on the window', async () => {
    await import('../../src/renderer/src/lib/monacoConfig')
    expect((window as any).MonacoEnvironment).toBeDefined()
    expect(typeof (window as any).MonacoEnvironment.getWorker).toBe('function')
  })

  it('getWorker returns json worker for json label', async () => {
    await import('../../src/renderer/src/lib/monacoConfig')
    const env = (window as any).MonacoEnvironment
    env.getWorker('', 'json')
    expect(MockJsonWorker).toHaveBeenCalled()
  })

  it('getWorker returns ts worker for typescript label', async () => {
    await import('../../src/renderer/src/lib/monacoConfig')
    const env = (window as any).MonacoEnvironment
    env.getWorker('', 'typescript')
    expect(MockTsWorker).toHaveBeenCalled()
  })

  it('getWorker returns ts worker for javascript label', async () => {
    await import('../../src/renderer/src/lib/monacoConfig')
    const env = (window as any).MonacoEnvironment
    env.getWorker('', 'javascript')
    expect(MockTsWorker).toHaveBeenCalled()
  })

  it('getWorker returns editor worker as default', async () => {
    await import('../../src/renderer/src/lib/monacoConfig')
    const env = (window as any).MonacoEnvironment
    env.getWorker('', 'unknown')
    expect(MockEditorWorker).toHaveBeenCalled()
  })

  it('initMonaco returns the monaco object', async () => {
    const { initMonaco } = await import('../../src/renderer/src/lib/monacoConfig')
    const result = await initMonaco()
    expect(result).toBeDefined()
  })
})
