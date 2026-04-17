import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FileTree from '../../src/renderer/src/components/FileTree.svelte'

const mockListDir = vi.fn()

beforeEach(() => {
  vi.stubGlobal('api', { listContainerDir: mockListDir })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('FileTree', () => {
  it('loads root directory on mount and renders its entries', async () => {
    mockListDir.mockResolvedValue([
      { name: 'src', isDir: true },
      { name: 'README.md', isDir: false }
    ])
    render(FileTree, {
      containerId: 'ctr1',
      roots: [{ rootPath: '/workspace/myrepo', label: 'myrepo' }],
      onFileSelect: vi.fn()
    })
    expect(mockListDir).toHaveBeenCalledWith('ctr1', '/workspace/myrepo')
    expect(await screen.findByText('src')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('expands a directory and loads its children on click', async () => {
    mockListDir
      .mockResolvedValueOnce([{ name: 'src', isDir: true }])
      .mockResolvedValueOnce([{ name: 'index.ts', isDir: false }])
    render(FileTree, { containerId: 'c', roots: [{ rootPath: '/workspace/r', label: 'r' }], onFileSelect: vi.fn() })
    const srcBtn = await screen.findByText('src')
    await fireEvent.click(srcBtn)
    expect(mockListDir).toHaveBeenCalledWith('c', '/workspace/r/src')
    expect(await screen.findByText('index.ts')).toBeInTheDocument()
  })

  it('calls onFileSelect with the full path when a file is clicked', async () => {
    mockListDir.mockResolvedValue([{ name: 'app.ts', isDir: false }])
    const onFileSelect = vi.fn()
    render(FileTree, { containerId: 'c', roots: [{ rootPath: '/workspace/r', label: 'r' }], onFileSelect })
    await fireEvent.click(await screen.findByText('app.ts'))
    expect(onFileSelect).toHaveBeenCalledWith('/workspace/r/app.ts')
  })

  it('does not re-fetch a directory that is already loaded when clicked again', async () => {
    mockListDir
      .mockResolvedValueOnce([{ name: 'src', isDir: true }])
      .mockResolvedValueOnce([{ name: 'index.ts', isDir: false }])
    render(FileTree, { containerId: 'c', roots: [{ rootPath: '/workspace/r', label: 'r' }], onFileSelect: vi.fn() })
    const srcBtn = await screen.findByText('src')
    await fireEvent.click(srcBtn) // expand (fetches children)
    await fireEvent.click(srcBtn) // collapse
    await fireEvent.click(srcBtn) // re-expand (should NOT fetch again)
    expect(mockListDir).toHaveBeenCalledTimes(2) // root + src once
  })

  it('collapses an expanded directory on second click', async () => {
    mockListDir
      .mockResolvedValueOnce([{ name: 'src', isDir: true }])
      .mockResolvedValueOnce([{ name: 'index.ts', isDir: false }])
    render(FileTree, { containerId: 'c', roots: [{ rootPath: '/workspace/r', label: 'r' }], onFileSelect: vi.fn() })
    const srcBtn = await screen.findByText('src')
    await fireEvent.click(srcBtn) // expand
    expect(await screen.findByText('index.ts')).toBeInTheDocument()
    await fireEvent.click(srcBtn) // collapse
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument()
  })
})

describe('multi-root FileTree', () => {
  it('renders a label for each root as a top-level collapsible node', async () => {
    mockListDir
      .mockResolvedValueOnce([{ name: 'file-a.ts', isDir: false }])
      .mockResolvedValueOnce([{ name: 'file-b.ts', isDir: false }])
    render(FileTree, {
      containerId: 'ctr',
      roots: [
        { rootPath: '/workspace/project-a', label: 'project-a' },
        { rootPath: '/workspace/project-b', label: 'project-b' }
      ],
      onFileSelect: vi.fn()
    })
    expect(await screen.findByText('project-a')).toBeInTheDocument()
    expect(await screen.findByText('project-b')).toBeInTheDocument()
  })

  it('loads each root directory on mount', async () => {
    mockListDir.mockResolvedValue([])
    render(FileTree, {
      containerId: 'ctr',
      roots: [
        { rootPath: '/workspace/a', label: 'a' },
        { rootPath: '/workspace/b', label: 'b' }
      ],
      onFileSelect: vi.fn()
    })
    await screen.findByText('a')
    expect(mockListDir).toHaveBeenCalledWith('ctr', '/workspace/a')
    expect(mockListDir).toHaveBeenCalledWith('ctr', '/workspace/b')
  })

  it('single-root mode: backwards-compatible when roots has one entry', async () => {
    mockListDir.mockResolvedValue([{ name: 'index.ts', isDir: false }])
    render(FileTree, {
      containerId: 'c',
      roots: [{ rootPath: '/workspace/r', label: 'r' }],
      onFileSelect: vi.fn()
    })
    expect(await screen.findByText('index.ts')).toBeInTheDocument()
  })

  it('scrollToRoot expands and is callable without throwing', async () => {
    mockListDir.mockResolvedValue([])
    const { component } = render(FileTree, {
      containerId: 'c',
      roots: [{ rootPath: '/workspace/a', label: 'a' }, { rootPath: '/workspace/b', label: 'b' }],
      onFileSelect: vi.fn()
    })
    await screen.findByText('a')
    expect(() => component.scrollToRoot('/workspace/b')).not.toThrow()
  })
})
