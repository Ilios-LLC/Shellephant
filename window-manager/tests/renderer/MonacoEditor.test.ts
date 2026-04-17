import { render, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAddCommand,
  mockGetPosition,
  mockSetPosition,
  mockGetValue,
  mockSetValue,
  mockGetFullModelRange,
  mockPushEditOperations,
  mockRevealLineInCenter,
  mockDispose,
  mockModel,
  mockEditor,
  mockMonaco,
  getDidChangeContentCb,
  setDidChangeContentCb,
  getCursorPositionCb,
  setCursorPositionCb
} = vi.hoisted(() => {
  const mockAddCommand = vi.fn()
  const mockGetPosition = vi.fn().mockReturnValue({ lineNumber: 1, column: 1 })
  const mockSetPosition = vi.fn()
  const mockGetValue = vi.fn().mockReturnValue('')
  const mockSetValue = vi.fn()
  const mockGetFullModelRange = vi.fn().mockReturnValue({})
  const mockPushEditOperations = vi.fn()
  const mockRevealLineInCenter = vi.fn()
  const mockDispose = vi.fn()
  let didChangeContentCb: (() => void) | null = null
  let cursorPositionCb: ((e: { position: { lineNumber: number; column: number } }) => void) | null = null

  const mockModel = {
    getValue: mockGetValue,
    setValue: mockSetValue,
    getFullModelRange: mockGetFullModelRange,
    pushEditOperations: mockPushEditOperations,
    getLanguageId: vi.fn().mockReturnValue('typescript'),
    dispose: vi.fn(),
    onDidChangeContent: (cb: () => void) => {
      didChangeContentCb = cb
      return { dispose: vi.fn() }
    }
  }

  const mockEditor = {
    getModel: vi.fn().mockReturnValue(mockModel),
    setModel: vi.fn(),
    getValue: mockGetValue,
    getPosition: mockGetPosition,
    setPosition: mockSetPosition,
    addCommand: mockAddCommand,
    revealLineInCenter: mockRevealLineInCenter,
    dispose: mockDispose,
    onDidChangeCursorPosition: vi.fn().mockImplementation((cb) => {
      cursorPositionCb = cb
      return { dispose: vi.fn() }
    }),
    onDidChangeModelLanguage: vi.fn().mockReturnValue({ dispose: vi.fn() })
  }

  const mockMonaco = {
    editor: {
      create: vi.fn().mockReturnValue(mockEditor),
      getModel: vi.fn().mockReturnValue(undefined),
      createModel: vi.fn().mockReturnValue(mockModel),
      getModels: vi.fn().mockReturnValue([])
    },
    Uri: { parse: vi.fn().mockImplementation((s: string) => ({ toString: () => s })) },
    KeyMod: { CtrlCmd: 2048, Shift: 1024 },
    KeyCode: { KeyS: 49, KeyW: 47, Tab: 2, KeyF: 33 }
  }

  return {
    mockAddCommand, mockGetPosition, mockSetPosition, mockGetValue, mockSetValue,
    mockGetFullModelRange, mockPushEditOperations, mockRevealLineInCenter, mockDispose,
    mockModel, mockEditor, mockMonaco,
    getDidChangeContentCb: () => didChangeContentCb,
    setDidChangeContentCb: (cb: (() => void) | null) => { didChangeContentCb = cb },
    getCursorPositionCb: () => cursorPositionCb,
    setCursorPositionCb: (cb: typeof cursorPositionCb) => { cursorPositionCb = cb }
  }
})

vi.mock('../../src/renderer/src/lib/monacoConfig', () => ({
  initMonaco: vi.fn().mockResolvedValue(mockMonaco)
}))

import MonacoEditor from '../../src/renderer/src/components/MonacoEditor.svelte'

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockGetValue.mockReturnValue('')
  mockPushEditOperations.mockReset()
  mockRevealLineInCenter.mockReset()
  mockAddCommand.mockReset()
  setDidChangeContentCb(null)
  setCursorPositionCb(null)
  mockMonaco.editor.getModel.mockReturnValue(undefined)
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

  it('creates a model with a URI that carries the file extension (so Monaco picks the language)', async () => {
    mockReadFile.mockResolvedValue('{}')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/settings.json' })
    await vi.waitFor(() => expect(mockMonaco.editor.createModel).toHaveBeenCalled())
    const uriArg = mockMonaco.Uri.parse.mock.calls[0][0]
    expect(uriArg).toMatch(/\.json$/)
    // language argument is `undefined` so Monaco infers from URI extension
    const [, langArg] = mockMonaco.editor.createModel.mock.calls[0]
    expect(langArg).toBeUndefined()
  })

  it('disposes editor on unmount', async () => {
    mockReadFile.mockResolvedValue('')
    const { unmount } = render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts' })
    await vi.waitFor(() => expect(mockMonaco.editor.create).toHaveBeenCalled())
    unmount()
    expect(mockDispose).toHaveBeenCalled()
  })

  it('calls onDirtyChange(path, true) when content changes', async () => {
    const onDirtyChange = vi.fn()
    mockReadFile.mockResolvedValue('original')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts', onDirtyChange })
    await vi.waitFor(() => expect(getDidChangeContentCb()).not.toBeNull())
    getDidChangeContentCb()!()
    expect(onDirtyChange).toHaveBeenCalledWith('/workspace/r/file.ts', true)
  })

  it('calls onDirtyChange(path, false) after save', async () => {
    const onDirtyChange = vi.fn()
    mockReadFile.mockResolvedValue('hello')
    mockGetValue.mockReturnValue('hello edited')
    mockWriteFile.mockResolvedValue(undefined)
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts', onDirtyChange })
    await vi.waitFor(() => expect(mockAddCommand).toHaveBeenCalled())
    getDidChangeContentCb()?.()
    const saveCallback = mockAddCommand.mock.calls[0][1] as () => void
    saveCallback()
    await vi.waitFor(() => {
      expect(onDirtyChange).toHaveBeenCalledWith('/workspace/r/file.ts', false)
    })
  })

  it('calls onStatusChange with line and column on cursor move', async () => {
    const onStatusChange = vi.fn()
    mockReadFile.mockResolvedValue('')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts', onStatusChange })
    await vi.waitFor(() => expect(getCursorPositionCb()).not.toBeNull())
    getCursorPositionCb()!({ position: { lineNumber: 5, column: 10 } })
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ line: 5, column: 10 }))
  })

  it('populates ref.gotoLine which calls revealLineInCenter and setPosition', async () => {
    mockReadFile.mockResolvedValue('')
    let capturedRef: { gotoLine: (n: number) => void } | null = null
    render(MonacoEditor, {
      containerId: 'ctr',
      filePath: '/workspace/r/file.ts',
      get ref() { return capturedRef },
      set ref(v) { capturedRef = v }
    })
    await vi.waitFor(() => expect(capturedRef).not.toBeNull())
    capturedRef!.gotoLine(42)
    expect(mockRevealLineInCenter).toHaveBeenCalledWith(42)
    expect(mockSetPosition).toHaveBeenCalledWith({ lineNumber: 42, column: 1 })
  })

  it('does not reload from disk when filePath changes to a path with existing Monaco model', async () => {
    mockReadFile.mockResolvedValue('original content')
    mockMonaco.editor.getModel.mockReturnValue(mockModel)
    const { rerender } = render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/foo.ts' })
    await vi.waitFor(() => expect(mockReadFile).toHaveBeenCalledTimes(1))
    mockReadFile.mockClear()
    await rerender({ containerId: 'ctr', filePath: '/workspace/r/bar.ts' })
    await vi.waitFor(() => expect(mockEditor.setModel).toHaveBeenCalledTimes(2))
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('Ctrl+W command calls onCloseTab', async () => {
    const onCloseTab = vi.fn()
    mockReadFile.mockResolvedValue('')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts', onCloseTab })
    await vi.waitFor(() => expect(mockAddCommand).toHaveBeenCalled())
    // Find the command registered with CtrlCmd | KeyW (2048 | 47 = 2095)
    const call = mockAddCommand.mock.calls.find((c) => c[0] === (2048 | 47))
    expect(call).toBeDefined()
    call![1]()
    expect(onCloseTab).toHaveBeenCalled()
  })

  it('Ctrl+Tab command calls onCycleNext', async () => {
    const onCycleNext = vi.fn()
    mockReadFile.mockResolvedValue('')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts', onCycleNext })
    await vi.waitFor(() => expect(mockAddCommand).toHaveBeenCalled())
    // CtrlCmd | Tab (2048 | 2 = 2050)
    const call = mockAddCommand.mock.calls.find((c) => c[0] === (2048 | 2))
    expect(call).toBeDefined()
    call![1]()
    expect(onCycleNext).toHaveBeenCalled()
  })

  it('Ctrl+Shift+Tab command calls onCyclePrev', async () => {
    const onCyclePrev = vi.fn()
    mockReadFile.mockResolvedValue('')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts', onCyclePrev })
    await vi.waitFor(() => expect(mockAddCommand).toHaveBeenCalled())
    // CtrlCmd | Shift | Tab (2048 | 1024 | 2 = 3074)
    const call = mockAddCommand.mock.calls.find((c) => c[0] === (2048 | 1024 | 2))
    expect(call).toBeDefined()
    call![1]()
    expect(onCyclePrev).toHaveBeenCalled()
  })

  it('Ctrl+Shift+F command calls onToggleFind', async () => {
    const onToggleFind = vi.fn()
    mockReadFile.mockResolvedValue('')
    render(MonacoEditor, { containerId: 'ctr', filePath: '/workspace/r/file.ts', onToggleFind })
    await vi.waitFor(() => expect(mockAddCommand).toHaveBeenCalled())
    // CtrlCmd | Shift | KeyF (2048 | 1024 | 33 = 3105)
    const call = mockAddCommand.mock.calls.find((c) => c[0] === (2048 | 1024 | 33))
    expect(call).toBeDefined()
    call![1]()
    expect(onToggleFind).toHaveBeenCalled()
  })
})
