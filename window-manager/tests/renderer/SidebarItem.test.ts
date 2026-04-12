import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarItem from '../../src/renderer/src/components/SidebarItem.svelte'
import type { WindowRecord } from '../../src/renderer/src/types'

const runningWindow: WindowRecord = {
  id: 7,
  name: 'alpha',
  container_id: 'abc123def456xyz',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running'
}

describe('SidebarItem', () => {
  let onSelect: ReturnType<typeof vi.fn>
  let onDelete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSelect = vi.fn()
    onDelete = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the name and first 12 chars of container_id', () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    expect(screen.getByText('alpha')).toBeDefined()
    expect(screen.getByText('abc123def456')).toBeDefined()
  })

  it('renders a status dot with class reflecting status', () => {
    const { container } = render(SidebarItem, {
      win: runningWindow,
      selected: false,
      onSelect,
      onDelete
    })
    const dot = container.querySelector('[data-testid="status-dot"]')
    expect(dot).not.toBeNull()
    expect(dot!.classList.contains('status-running')).toBe(true)
  })

  it('applies a selected class when selected is true', () => {
    const { container } = render(SidebarItem, {
      win: runningWindow,
      selected: true,
      onSelect,
      onDelete
    })
    const row = container.querySelector('[data-testid="sidebar-item"]')
    expect(row!.classList.contains('selected')).toBe(true)
  })

  it('clicking the row calls onSelect with the window', async () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    await fireEvent.click(screen.getByTestId('sidebar-item'))
    expect(onSelect).toHaveBeenCalledWith(runningWindow)
  })

  it('first click on delete enters confirming state without calling onDelete', async () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    const deleteBtn = screen.getByRole('button', { name: /delete/i })
    await fireEvent.click(deleteBtn)
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm delete/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined()
  })

  it('clicking confirm calls onDelete with the window id', async () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    await fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }))
    expect(onDelete).toHaveBeenCalledWith(7)
  })

  it('clicking cancel reverts to normal state and does not call onDelete', async () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    await fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /delete/i })).toBeDefined()
  })

  it('clicking delete does not trigger onSelect', async () => {
    render(SidebarItem, { win: runningWindow, selected: false, onSelect, onDelete })
    await fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
