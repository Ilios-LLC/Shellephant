import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmptyState from '../../src/renderer/src/components/EmptyState.svelte'

describe('EmptyState', () => {
  afterEach(() => cleanup())

  it('renders the heading', () => {
    render(EmptyState, {})
    expect(screen.getByText(/no project selected/i)).toBeDefined()
  })

  it('renders the hint', () => {
    render(EmptyState, {})
    expect(screen.getByText(/create a project/i)).toBeDefined()
  })

  it('shows a CTA button when onRequestNewProject is provided', async () => {
    const onRequestNewProject = vi.fn()
    render(EmptyState, { onRequestNewProject })
    const button = screen.getByRole('button', { name: /new project/i })
    await fireEvent.click(button)
    expect(onRequestNewProject).toHaveBeenCalled()
  })

  it('omits the CTA button when onRequestNewProject is absent', () => {
    render(EmptyState, {})
    expect(screen.queryByRole('button', { name: /new project/i })).toBeNull()
  })
})
