import { render, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockFileTreeScrollToRoot = vi.fn()

vi.mock('../../src/renderer/src/components/FileTree.svelte', () => ({
  default: vi.fn(() => ({ scrollToRoot: mockFileTreeScrollToRoot }))
}))

vi.mock('../../src/renderer/src/components/MonacoEditor.svelte', () => ({
  default: vi.fn(() => ({}))
}))

import EditorPane from '../../src/renderer/src/components/EditorPane.svelte'
import FileTree from '../../src/renderer/src/components/FileTree.svelte'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EditorPane', () => {
  it('renders without error when given a single root', () => {
    const { container } = render(EditorPane, {
      containerId: 'ctr',
      roots: [{ rootPath: '/workspace/r', label: 'r' }]
    })
    expect(container.querySelector('.editor-pane')).toBeInTheDocument()
  })

  it('passes roots array to FileTree', () => {
    render(EditorPane, {
      containerId: 'ctr',
      roots: [
        { rootPath: '/workspace/a', label: 'proj-a' },
        { rootPath: '/workspace/b', label: 'proj-b' }
      ]
    })
    const fileTreeCalls = vi.mocked(FileTree).mock.calls
    expect(fileTreeCalls.length).toBeGreaterThan(0)
    const props = fileTreeCalls[0][1] as Record<string, unknown>
    expect(props.roots).toEqual([
      { rootPath: '/workspace/a', label: 'proj-a' },
      { rootPath: '/workspace/b', label: 'proj-b' }
    ])
  })

  it('scrollToRoot delegates to fileTreeRef', () => {
    const { component } = render(EditorPane, {
      containerId: 'c',
      roots: [{ rootPath: '/workspace/a', label: 'a' }, { rootPath: '/workspace/b', label: 'b' }]
    })
    expect(() => component.scrollToRoot('/workspace/b')).not.toThrow()
  })
})
