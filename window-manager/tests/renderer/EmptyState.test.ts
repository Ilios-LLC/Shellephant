import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmptyState from '../../src/renderer/src/components/EmptyState.svelte'

describe('EmptyState', () => {
  afterEach(() => cleanup())

  it('does not render the "Running Windows" heading when windows are present', () => {
    const allWindows = [
      { id: 1, project_id: 1, name: 'win-a', status: 'running' },
      { id: 2, project_id: 1, name: 'win-b', status: 'running' }
    ]
    const projects = [{ id: 1, name: 'proj-a' }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(EmptyState, { allWindows, projects } as any)
    expect(screen.queryByText(/running windows/i)).toBeNull()
  })

  it('does not render any "no windows running" copy when none are running', () => {
    render(EmptyState, {})
    expect(screen.queryByText(/no windows running/i)).toBeNull()
    expect(screen.queryByText(/create a project/i)).toBeNull()
  })

  it('shows a CTA button when onRequestNewProject is provided and no windows are running', async () => {
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
