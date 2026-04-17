import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FindInFiles from '../../src/renderer/src/components/FindInFiles.svelte'

const mockExecInContainer = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('api', { execInContainer: mockExecInContainer })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('FindInFiles', () => {
  it('renders query input and file filter input', () => {
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    expect(screen.getByLabelText('search query')).toBeInTheDocument()
    expect(screen.getByLabelText('file filter')).toBeInTheDocument()
  })

  it('does not search on empty query', async () => {
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await vi.advanceTimersByTimeAsync(500)
    expect(mockExecInContainer).not.toHaveBeenCalled()
  })

  it('debounces search — does not call exec immediately on input', async () => {
    mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    const input = screen.getByLabelText('search query')
    await fireEvent.input(input, { target: { value: 'foo' } })
    expect(mockExecInContainer).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(mockExecInContainer).toHaveBeenCalledWith('ctr', expect.arrayContaining(['grep', '-rn']))
  })

  it('passes rootPath and query to grep command', async () => {
    mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'findMe' } })
    await vi.advanceTimersByTimeAsync(400)
    const cmd: string[] = mockExecInContainer.mock.calls[0][1]
    expect(cmd).toContain('findMe')
    expect(cmd).toContain('/workspace/r')
  })

  it('fires search immediately on Enter without waiting for debounce', async () => {
    mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    const input = screen.getByLabelText('search query')
    await fireEvent.input(input, { target: { value: 'bar' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockExecInContainer).toHaveBeenCalled()
  })

  it('shows grouped results with file paths and match counts', async () => {
    mockExecInContainer.mockResolvedValue({
      ok: true,
      code: 0,
      stdout: [
        '/workspace/r/src/foo.ts:12:const foo = 1',
        '/workspace/r/src/foo.ts:45:foo()',
        '/workspace/r/bar.ts:7:foo bar'
      ].join('\n') + '\n'
    })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'foo' } })
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => {
      expect(screen.getByText('/workspace/r/src/foo.ts (2 matches)')).toBeInTheDocument()
    })
    expect(screen.getByText('/workspace/r/bar.ts (1 match)')).toBeInTheDocument()
  })

  it('shows line numbers and text snippets for each match', async () => {
    mockExecInContainer.mockResolvedValue({
      ok: true,
      code: 0,
      stdout: '/workspace/r/src/foo.ts:12:const foo = 1\n'
    })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'foo' } })
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(screen.getByText('12')).toBeInTheDocument())
    expect(screen.getByText('const foo = 1')).toBeInTheDocument()
  })

  it('calls onOpenFile with path and line when a result is clicked', async () => {
    mockExecInContainer.mockResolvedValue({
      ok: true,
      code: 0,
      stdout: '/workspace/r/src/foo.ts:12:const foo = 1\n'
    })
    const onOpenFile = vi.fn()
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'foo' } })
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'line 12' })).toBeInTheDocument())
    await fireEvent.click(screen.getByRole('button', { name: 'line 12' }))
    expect(onOpenFile).toHaveBeenCalledWith('/workspace/r/src/foo.ts', 12)
  })

  it('shows no-results message when grep returns empty stdout', async () => {
    mockExecInContainer.mockResolvedValue({ ok: false, code: 1, stdout: '' })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'xyz' } })
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => {
      expect(screen.getByText(/no results for/i)).toBeInTheDocument()
    })
  })

  it('shows error message when execInContainer throws', async () => {
    mockExecInContainer.mockRejectedValue(new Error('exec failed'))
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'foo' } })
    await vi.advanceTimersByTimeAsync(400)
    await vi.waitFor(() => {
      expect(screen.getByText('exec failed')).toBeInTheDocument()
    })
  })

  it('includes --include flag when glob filter is not the default *', async () => {
    mockExecInContainer.mockResolvedValue({ ok: true, code: 0, stdout: '' })
    render(FindInFiles, { containerId: 'ctr', rootPath: '/workspace/r', onOpenFile: vi.fn() })
    await fireEvent.input(screen.getByLabelText('file filter'), { target: { value: '*.ts' } })
    await fireEvent.input(screen.getByLabelText('search query'), { target: { value: 'foo' } })
    await vi.advanceTimersByTimeAsync(400)
    const cmd: string[] = mockExecInContainer.mock.calls[0][1]
    expect(cmd).toContain('--include=*.ts')
  })
})
