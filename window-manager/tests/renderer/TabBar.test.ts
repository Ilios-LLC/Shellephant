import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TabBar from '../../src/renderer/src/components/TabBar.svelte'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TabBar', () => {
  const tabs = ['/workspace/r/foo.ts', '/workspace/r/bar.ts']

  it('renders basenames of open files', () => {
    render(TabBar, {
      tabs,
      activeTab: tabs[0],
      dirtyTabs: new Set<string>(),
      onActivate: vi.fn(),
      onClose: vi.fn()
    })
    expect(screen.getByText('foo.ts')).toBeInTheDocument()
    expect(screen.getByText('bar.ts')).toBeInTheDocument()
  })

  it('shows full path as title tooltip', () => {
    render(TabBar, {
      tabs: ['/workspace/r/foo.ts'],
      activeTab: null,
      dirtyTabs: new Set<string>(),
      onActivate: vi.fn(),
      onClose: vi.fn()
    })
    expect(screen.getByTitle('/workspace/r/foo.ts')).toBeInTheDocument()
  })

  it('marks active tab with aria-selected=true', () => {
    render(TabBar, { tabs, activeTab: tabs[0], dirtyTabs: new Set<string>(), onActivate: vi.fn(), onClose: vi.fn() })
    expect(screen.getByTitle(tabs[0])).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTitle(tabs[1])).toHaveAttribute('aria-selected', 'false')
  })

  it('shows close button on non-dirty tab', () => {
    render(TabBar, {
      tabs: ['/workspace/r/foo.ts'],
      activeTab: null,
      dirtyTabs: new Set<string>(),
      onActivate: vi.fn(),
      onClose: vi.fn()
    })
    expect(screen.getByRole('button', { name: /close foo\.ts/i })).toBeInTheDocument()
  })

  it('shows dirty dot instead of close button on dirty tab', () => {
    render(TabBar, {
      tabs: ['/workspace/r/foo.ts'],
      activeTab: null,
      dirtyTabs: new Set(['/workspace/r/foo.ts']),
      onActivate: vi.fn(),
      onClose: vi.fn()
    })
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close foo\.ts/i })).not.toBeInTheDocument()
  })

  it('calls onActivate with path when tab is clicked', async () => {
    const onActivate = vi.fn()
    render(TabBar, { tabs, activeTab: null, dirtyTabs: new Set<string>(), onActivate, onClose: vi.fn() })
    await fireEvent.click(screen.getByTitle(tabs[0]))
    expect(onActivate).toHaveBeenCalledWith(tabs[0])
  })

  it('calls onClose with path when close button is clicked', async () => {
    const onClose = vi.fn()
    render(TabBar, {
      tabs: ['/workspace/r/foo.ts'],
      activeTab: null,
      dirtyTabs: new Set<string>(),
      onActivate: vi.fn(),
      onClose
    })
    await fireEvent.click(screen.getByRole('button', { name: /close foo\.ts/i }))
    expect(onClose).toHaveBeenCalledWith('/workspace/r/foo.ts')
  })

  it('does not call onActivate when close button is clicked', async () => {
    const onActivate = vi.fn()
    render(TabBar, {
      tabs: ['/workspace/r/foo.ts'],
      activeTab: null,
      dirtyTabs: new Set<string>(),
      onActivate,
      onClose: vi.fn()
    })
    await fireEvent.click(screen.getByRole('button', { name: /close foo\.ts/i }))
    expect(onActivate).not.toHaveBeenCalled()
  })
})
