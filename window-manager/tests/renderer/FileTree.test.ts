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
      rootPath: '/workspace/myrepo',
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
    render(FileTree, { containerId: 'c', rootPath: '/workspace/r', onFileSelect: vi.fn() })
    const srcBtn = await screen.findByText('src')
    await fireEvent.click(srcBtn)
    expect(mockListDir).toHaveBeenCalledWith('c', '/workspace/r/src')
    expect(await screen.findByText('index.ts')).toBeInTheDocument()
  })

  it('calls onFileSelect with the full path when a file is clicked', async () => {
    mockListDir.mockResolvedValue([{ name: 'app.ts', isDir: false }])
    const onFileSelect = vi.fn()
    render(FileTree, { containerId: 'c', rootPath: '/workspace/r', onFileSelect })
    await fireEvent.click(await screen.findByText('app.ts'))
    expect(onFileSelect).toHaveBeenCalledWith('/workspace/r/app.ts')
  })

  it('does not re-fetch a directory that is already loaded when clicked again', async () => {
    mockListDir
      .mockResolvedValueOnce([{ name: 'src', isDir: true }])
      .mockResolvedValueOnce([{ name: 'index.ts', isDir: false }])
    render(FileTree, { containerId: 'c', rootPath: '/workspace/r', onFileSelect: vi.fn() })
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
    render(FileTree, { containerId: 'c', rootPath: '/workspace/r', onFileSelect: vi.fn() })
    const srcBtn = await screen.findByText('src')
    await fireEvent.click(srcBtn) // expand
    expect(await screen.findByText('index.ts')).toBeInTheDocument()
    await fireEvent.click(srcBtn) // collapse
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument()
  })
})
