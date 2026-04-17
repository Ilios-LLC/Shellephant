import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture FileTree's onFileSelect so tests can simulate file selection.
// Svelte 5 calls components as Component(anchor, props).
const shared = vi.hoisted(() => ({
  fileTreeOnFileSelect: null as ((path: string) => void) | null,
  monacoOnDirtyChange: null as ((path: string, dirty: boolean) => void) | null
}))

vi.mock('../../src/renderer/src/components/FileTree.svelte', () => ({
  default: vi.fn((_anchor: unknown, props: { onFileSelect: (path: string) => void }) => {
    shared.fileTreeOnFileSelect = props.onFileSelect
    return {}
  })
}))

vi.mock('../../src/renderer/src/components/MonacoEditor.svelte', () => ({
  default: vi.fn((_anchor: unknown, props: { onDirtyChange?: (path: string, dirty: boolean) => void }) => {
    shared.monacoOnDirtyChange = props.onDirtyChange ?? null
    return {}
  })
}))

vi.mock('../../src/renderer/src/components/FindInFiles.svelte', () => ({
  default: vi.fn(() => ({}))
}))

import EditorPane from '../../src/renderer/src/components/EditorPane.svelte'

beforeEach(() => {
  shared.fileTreeOnFileSelect = null
  shared.monacoOnDirtyChange = null
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EditorPane', () => {
  it('renders the file tree panel by default', () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    expect(screen.getByLabelText('toggle find in files')).toBeInTheDocument()
  })

  it('opens a tab when a file is selected', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    expect(await screen.findByText('foo.ts')).toBeInTheDocument()
  })

  it('does not duplicate tab when same file selected twice', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    await vi.waitFor(() => expect(screen.getAllByText('foo.ts')).toHaveLength(1))
  })

  it('activates a tab when its button is clicked', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    shared.fileTreeOnFileSelect!('/workspace/r/bar.ts')
    await vi.waitFor(() => expect(screen.getByText('foo.ts')).toBeInTheDocument())
    await fireEvent.click(screen.getByTitle('/workspace/r/foo.ts'))
    expect(screen.getByTitle('/workspace/r/foo.ts')).toHaveAttribute('aria-selected', 'true')
  })

  it('closes a tab when its close button is clicked', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    await vi.waitFor(() => expect(screen.getByText('foo.ts')).toBeInTheDocument())
    await fireEvent.click(screen.getByRole('button', { name: /close foo\.ts/i }))
    expect(screen.queryByText('foo.ts')).not.toBeInTheDocument()
  })

  it('activates right neighbor when active tab is closed and right neighbor exists', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    shared.fileTreeOnFileSelect!('/workspace/r/bar.ts')
    await vi.waitFor(() => expect(screen.getByText('foo.ts')).toBeInTheDocument())
    // Activate foo.ts first
    await fireEvent.click(screen.getByTitle('/workspace/r/foo.ts'))
    // Close foo.ts — bar.ts is right neighbor
    await fireEvent.click(screen.getByRole('button', { name: /close foo\.ts/i }))
    await vi.waitFor(() => {
      expect(screen.getByTitle('/workspace/r/bar.ts')).toHaveAttribute('aria-selected', 'true')
    })
  })

  it('adds to dirtyTabs when onDirtyChange fires with dirty=true', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    await vi.waitFor(() => expect(shared.monacoOnDirtyChange).not.toBeNull())
    shared.monacoOnDirtyChange!('/workspace/r/foo.ts', true)
    await vi.waitFor(() => {
      expect(screen.getAllByLabelText('unsaved changes').length).toBeGreaterThan(0)
    })
  })

  it('removes from dirtyTabs when onDirtyChange fires with dirty=false', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await vi.waitFor(() => expect(shared.fileTreeOnFileSelect).not.toBeNull())
    shared.fileTreeOnFileSelect!('/workspace/r/foo.ts')
    await vi.waitFor(() => expect(shared.monacoOnDirtyChange).not.toBeNull())
    shared.monacoOnDirtyChange!('/workspace/r/foo.ts', true)
    await vi.waitFor(() => expect(screen.getAllByLabelText('unsaved changes').length).toBeGreaterThan(0))
    shared.monacoOnDirtyChange!('/workspace/r/foo.ts', false)
    await vi.waitFor(() => {
      expect(screen.queryAllByLabelText('unsaved changes')).toHaveLength(0)
    })
  })

  it('toggles find-in-files panel when toggle button is clicked', async () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    await fireEvent.click(screen.getByLabelText('toggle find in files'))
    expect(screen.getByLabelText('close find')).toBeInTheDocument()
    await fireEvent.click(screen.getByLabelText('close find'))
    expect(screen.getByLabelText('toggle find in files')).toBeInTheDocument()
  })

  it('renders StatusBar', () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    expect(screen.getByText('Ln 1, Col 1')).toBeInTheDocument()
  })
})
