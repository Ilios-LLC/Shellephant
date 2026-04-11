import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WindowCard from '../../src/renderer/src/components/WindowCard.svelte'
import type { WindowRecord } from '../../src/renderer/src/types'

const mockWindow: WindowRecord = {
  id: 42,
  name: 'My Test Window',
  container_id: 'abc123def456xyz',
  created_at: '2026-01-01T00:00:00Z',
}

describe('WindowCard', () => {
  let mockOnOpen: ReturnType<typeof vi.fn>
  let mockOnDelete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockOnOpen = vi.fn()
    mockOnDelete = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the window name', () => {
    render(WindowCard, { win: mockWindow, onOpen: mockOnOpen, onDelete: mockOnDelete })
    expect(screen.getByText('My Test Window')).toBeDefined()
  })

  it('renders first 12 chars of container_id', () => {
    render(WindowCard, { win: mockWindow, onOpen: mockOnOpen, onDelete: mockOnDelete })
    expect(screen.getByText('abc123def456')).toBeDefined()
  })

  it('renders a Delete button', () => {
    render(WindowCard, { win: mockWindow, onOpen: mockOnOpen, onDelete: mockOnDelete })
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDefined()
  })

  it('clicking the card open area calls onOpen with the window record', async () => {
    render(WindowCard, { win: mockWindow, onOpen: mockOnOpen, onDelete: mockOnDelete })
    const openArea = screen.getByTestId('window-card-open')
    await fireEvent.click(openArea)
    expect(mockOnOpen).toHaveBeenCalledWith(mockWindow)
  })

  it('clicking Delete calls onDelete with the window id', async () => {
    render(WindowCard, { win: mockWindow, onOpen: mockOnOpen, onDelete: mockOnDelete })
    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    await fireEvent.click(deleteButton)
    expect(mockOnDelete).toHaveBeenCalledWith(mockWindow.id)
  })

  it('clicking Delete does not trigger onOpen', async () => {
    render(WindowCard, { win: mockWindow, onOpen: mockOnOpen, onDelete: mockOnDelete })
    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    await fireEvent.click(deleteButton)
    expect(mockOnOpen).not.toHaveBeenCalled()
  })
})
