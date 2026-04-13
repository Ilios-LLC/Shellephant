import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../../src/renderer/src/components/Sidebar.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'

function makeProject(id: number, name: string): ProjectRecord {
  return {
    id,
    name,
    git_url: `git@github.com:org/${name}.git`,
    created_at: '2026-01-01T00:00:00Z'
  }
}

describe('Sidebar', () => {
  let onProjectSelect: ReturnType<typeof vi.fn>
  let onProjectCreated: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onProjectSelect = vi.fn()
    onProjectCreated = vi.fn()
  })

  afterEach(() => cleanup())

  it('renders an item per project', () => {
    const projects = [makeProject(1, 'alpha'), makeProject(2, 'beta')]
    render(Sidebar, { projects, selectedProjectId: null, onProjectSelect, onProjectCreated })
    expect(screen.getByText('alpha')).toBeDefined()
    expect(screen.getByText('beta')).toBeDefined()
  })

  it('shows empty hint when projects is empty', () => {
    render(Sidebar, { projects: [], selectedProjectId: null, onProjectSelect, onProjectCreated })
    expect(screen.getByText(/no projects/i)).toBeDefined()
  })

  it('clicking a project forwards to onProjectSelect', async () => {
    const p = makeProject(3, 'gamma')
    render(Sidebar, { projects: [p], selectedProjectId: null, onProjectSelect, onProjectCreated })
    await fireEvent.click(screen.getByText('gamma'))
    expect(onProjectSelect).toHaveBeenCalledWith(p)
  })

  it('passes selected state to the correct item', () => {
    const a = makeProject(1, 'a')
    const b = makeProject(2, 'b')
    const { container } = render(Sidebar, {
      projects: [a, b],
      selectedProjectId: 2,
      onProjectSelect,
      onProjectCreated
    })
    const items = container.querySelectorAll('[data-testid="project-item"]')
    expect(items[0].classList.contains('selected')).toBe(false)
    expect(items[1].classList.contains('selected')).toBe(true)
  })
})
