import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GroupStrip from '../../src/renderer/src/components/GroupStrip.svelte'
import type { ProjectGroupRecord } from '../../src/renderer/src/types'

function makeGroup(id: number, name: string): ProjectGroupRecord {
  return { id, name, created_at: '2026-01-01T00:00:00Z' }
}

describe('GroupStrip', () => {
  let onGroupSelect: ReturnType<typeof vi.fn>
  let onGroupCreated: ReturnType<typeof vi.fn>
  let mockCreateGroup: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onGroupSelect = vi.fn()
    onGroupCreated = vi.fn()
    mockCreateGroup = vi.fn()
    vi.stubGlobal('api', { createGroup: mockCreateGroup })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function baseProps(overrides: Record<string, unknown> = {}) {
    return {
      groups: [] as ProjectGroupRecord[],
      activeGroupId: null as number | 'ungrouped' | null,
      onGroupSelect,
      onGroupCreated,
      ...overrides
    }
  }

  it('renders a "new group" button', () => {
    render(GroupStrip, baseProps())
    expect(screen.getByRole('button', { name: /new group/i })).toBeDefined()
  })

  it('renders a "no group" button', () => {
    render(GroupStrip, baseProps())
    expect(screen.getByRole('button', { name: /no group/i })).toBeDefined()
  })

  it('clicking "no group" button calls onGroupSelect with "ungrouped"', async () => {
    render(GroupStrip, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /no group/i }))
    expect(onGroupSelect).toHaveBeenCalledWith('ungrouped')
  })

  it('"no group" button has active class when activeGroupId is "ungrouped"', () => {
    const { container } = render(GroupStrip, baseProps({ activeGroupId: 'ungrouped' }))
    const noGroupBtn = container.querySelector('[aria-label="no group"]')
    expect(noGroupBtn?.classList.contains('active')).toBe(true)
  })

  it('renders one button per group showing first letter', () => {
    render(GroupStrip, baseProps({ groups: [makeGroup(1, 'Alpha'), makeGroup(2, 'Beta')] }))
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Beta' })).toBeDefined()
    expect(screen.getByText('A')).toBeDefined()
    expect(screen.getByText('B')).toBeDefined()
  })

  it('clicking a group button calls onGroupSelect with its id', async () => {
    render(GroupStrip, baseProps({ groups: [makeGroup(1, 'Alpha')] }))
    await fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(onGroupSelect).toHaveBeenCalledWith(1)
  })

  it('active group button has "active" class', () => {
    const { container } = render(GroupStrip, baseProps({
      groups: [makeGroup(1, 'Alpha'), makeGroup(2, 'Beta')],
      activeGroupId: 2
    }))
    const icons = container.querySelectorAll('.group-icon:not(.add-btn)')
    // icons[0] = no-group button, icons[1] = Alpha, icons[2] = Beta
    expect(icons[1].classList.contains('active')).toBe(false)
    expect(icons[2].classList.contains('active')).toBe(true)
  })

  it('clicking "new group" button shows an input field', async () => {
    render(GroupStrip, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /new group/i }))
    expect(screen.getByPlaceholderText(/name/i)).toBeDefined()
  })

  it('pressing Escape cancels input and restores the "+" button', async () => {
    render(GroupStrip, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /new group/i }))
    const input = screen.getByPlaceholderText(/name/i)
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText(/name/i)).toBeNull()
    expect(screen.getByRole('button', { name: /new group/i })).toBeDefined()
  })

  it('pressing Enter with a name calls api.createGroup and onGroupCreated', async () => {
    const newGroup = makeGroup(3, 'Gamma')
    mockCreateGroup.mockResolvedValue(newGroup)
    render(GroupStrip, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /new group/i }))
    const input = screen.getByPlaceholderText(/name/i)
    await fireEvent.input(input, { target: { value: 'Gamma' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith('Gamma')
      expect(onGroupCreated).toHaveBeenCalledWith(newGroup)
    })
  })

  it('pressing Enter with empty name does not call api.createGroup', async () => {
    render(GroupStrip, baseProps())
    await fireEvent.click(screen.getByRole('button', { name: /new group/i }))
    const input = screen.getByPlaceholderText(/name/i)
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockCreateGroup).not.toHaveBeenCalled()
  })
})
