import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../../src/renderer/src/components/Sidebar.svelte'
import type { WindowRecord } from '../../src/renderer/src/types'

function makeWin(id: number, name: string): WindowRecord {
  return {
    id,
    name,
    container_id: `container-${id}-xxxxxxxxxx`,
    created_at: '2026-01-01T00:00:00Z',
    status: 'running'
  }
}

describe('Sidebar', () => {
  let onSelect: ReturnType<typeof vi.fn>
  let onCreated: ReturnType<typeof vi.fn>
  let onDelete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSelect = vi.fn()
    onCreated = vi.fn()
    onDelete = vi.fn()
  })

  afterEach(() => cleanup())

  it('renders an item per window', () => {
    const windows = [makeWin(1, 'alpha'), makeWin(2, 'beta')]
    render(Sidebar, { windows, selectedId: null, onSelect, onCreated, onDelete })
    expect(screen.getByText('alpha')).toBeDefined()
    expect(screen.getByText('beta')).toBeDefined()
  })

  it('shows the empty hint when windows is empty', () => {
    render(Sidebar, { windows: [], selectedId: null, onSelect, onCreated, onDelete })
    expect(screen.getByText(/no windows/i)).toBeDefined()
  })

  it('clicking an item forwards to onSelect with the window id', async () => {
    const w = makeWin(3, 'gamma')
    render(Sidebar, { windows: [w], selectedId: null, onSelect, onCreated, onDelete })
    await fireEvent.click(screen.getByText('gamma'))
    expect(onSelect).toHaveBeenCalledWith(3)
  })

  it('passes selected state to the correct item', () => {
    const a = makeWin(1, 'a')
    const b = makeWin(2, 'b')
    const { container } = render(Sidebar, {
      windows: [a, b],
      selectedId: 2,
      onSelect,
      onCreated,
      onDelete
    })
    const items = container.querySelectorAll('[data-testid="sidebar-item"]')
    expect(items[0].classList.contains('selected')).toBe(false)
    expect(items[1].classList.contains('selected')).toBe(true)
  })
})
