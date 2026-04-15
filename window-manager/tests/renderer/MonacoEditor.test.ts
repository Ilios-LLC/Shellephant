import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Hoist mocks so they are available when vi.mock factory runs ---
const {
  mockAddCommand,
  mockGetPosition,
  mockSetPosition,
  mockGetValue,
  mockSetValue,
  mockGetFullModelRange,
  mockPushEditOperations,
  mockDispose,
  mockModel,
  mockEditor,
  mockMonaco,
  getDidChangeContentCb,
  setDidChangeContentCb
} = vi.hoisted(() => {
  const mockAddCommand = vi.fn()
  const mockGetPosition = vi.fn().mockReturnValue({ lineNumber: 1, column: 1 })
  const mockSetPosition = vi.fn()
  const mockGetValue = vi.fn().mockReturnValue('')
  const mockSetValue = vi.fn()
  const mockGetFullModelRange = vi.fn().mockReturnValue({})
  const mockPushEditOperations = vi.fn()
  const mockDispose = vi.fn()
  let didChangeContentCb: (() => void) | null = null

  const mockModel = {
    getValue: mockGetValue,
    setValue: mockSetValue,
    getFullModelRange: mockGetFullModelRange,
    pushEditOperations: mockPushEditOperations,
    onDidChangeContent: (cb: () => void) => {
      didChangeContentCb = cb
      return { dispose: vi.fn() }
    }
  }

  const mockEditor = {
    getModel: vi.fn().mockReturnValue(mockModel),
    getValue: mockGetValue,
    getPosition: mockGetPosition,
    setPosition: mockSetPosition,
    addCommand: mockAddCommand,
    dispose: mockDispose
  }

  const mockMonaco = {
    editor: { create: vi.fn().mockReturnValue(mockEditor) },
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49 }
  }

  return {
    mockAddCommand,
    mockGetPosition,
    mockSetPosition,
    mockGetValue,
    mockSetValue,
    mockGetFullModelRange,
    mockPushEditOperations,
    mockDispose,
    mockModel,
    mockEditor,
    mockMonaco,
    getDidChangeContentCb: () => didChangeContentCb,
    setDidChangeContentCb: (cb: (() => void) | null) => { didChangeContentCb = cb }
  }
})

vi.mock('../../src/renderer/src/lib/monacoConfig', () => ({
  initMonaco: vi.fn().mockResolvedValue(mockMonaco)
}))

// --- Import component after mocks ---
import MonacoEditor from '../../src/renderer/src/components/MonacoEditor.svelte'

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockGetValue.mockReturnValue('')
  mockPushEditOperations.mockReset()
  setDidChangeContentCb(null)
  vi.stubGlobal('api', {
    readContainerFile: mockReadFile,
    writeContainerFile: mockWriteFile
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('MonacoEditor', () => {
  it('loads file content on mount', async () => {
    mockReadFile.mockResolvedValue('const x = 1\n')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/index.ts' })
    await vi.waitFor(() => {
      expect(mockReadFile).toHaveBeenCalledWith('ctr', '/workspace/r/index.ts')
    })
    await vi.waitFor(() => {
      expect(mockSetValue).toHaveBeenCalledWith('const x = 1\n')
    })
  })

  it('renders the file path in the header bar', async () => {
    mockReadFile.mockResolvedValue('')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/app.ts' })
    expect(await screen.findByText('/workspace/r/app.ts')).toBeInTheDocument()
  })

  it('marks dirty when Monaco content changes', async () => {
    mockReadFile.mockResolvedValue('original')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(getDidChangeContentCb()).not.toBeNull())
    // Simulate editor content change
    getDidChangeContentCb()!()
    // Poll tick — dirty, so should NOT call readContainerFile again
    mockReadFile.mockClear()
    await vi.advanceTimersByTimeAsync(2100)
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('registers Ctrl+S keybinding on mount', async () => {
    mockReadFile.mockResolvedValue('')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(mockAddCommand).toHaveBeenCalled())
    const [keybinding] = mockAddCommand.mock.calls[0]
    expect(keybinding).toBe(2048 | 49) // CtrlCmd | KeyS
  })

  it('saves file when Ctrl+S command fires', async () => {
    mockReadFile.mockResolvedValue('hello')
    mockGetValue.mockReturnValue('hello edited')
    mockWriteFile.mockResolvedValue(undefined)
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(mockAddCommand).toHaveBeenCalled())
    // Trigger the save command callback
    const saveCallback = mockAddCommand.mock.calls[0][1] as () => void
    getDidChangeContentCb()?.() // mark dirty
    saveCallback()
    await vi.waitFor(() => {
      expect(mockWriteFile).toHaveBeenCalledWith('ctr', '/workspace/r/file.ts', 'hello edited')
    })
  })

  it('polls file every 2 seconds and updates model when not dirty', async () => {
    mockReadFile.mockResolvedValueOnce('v1').mockResolvedValue('v2')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(mockSetValue).toHaveBeenCalledWith('v1'))
    mockReadFile.mockClear()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => {
      expect(mockReadFile).toHaveBeenCalledWith('ctr', '/workspace/r/file.ts')
      expect(mockPushEditOperations).toHaveBeenCalled()
    })
  })

  it('disposes editor on unmount', async () => {
    mockReadFile.mockResolvedValue('')
    const { unmount } = render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(mockMonaco.editor.create).toHaveBeenCalled())
    unmount()
    expect(mockDispose).toHaveBeenCalled()
  })
})
