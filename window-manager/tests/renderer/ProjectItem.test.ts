// tests/renderer/ProjectItem.test.ts
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProjectItem from '../../src/renderer/src/components/ProjectItem.svelte'
import type { ProjectRecord } from '../../src/renderer/src/types'

const project: ProjectRecord = {
  id: 1,
  name: 'my-project',
  git_url: 'git@github.com:org/my-project.git',
  created_at: '2026-01-01T00:00:00Z'
}

describe('ProjectItem', () => {
  afterEach(() => cleanup())

  it('renders project name', () => {
    render(ProjectItem, { project, selected: false, onSelect: vi.fn() })
    expect(screen.getByText('my-project')).toBeDefined()
  })

  it('renders git URL snippet', () => {
    render(ProjectItem, { project, selected: false, onSelect: vi.fn() })
    expect(screen.getByText('org/my-project')).toBeDefined()
  })

  it('calls onSelect with project when clicked', async () => {
    const onSelect = vi.fn()
    render(ProjectItem, { project, selected: false, onSelect })
    await fireEvent.click(screen.getByText('my-project'))
    expect(onSelect).toHaveBeenCalledWith(project)
  })

  it('applies selected class when selected is true', () => {
    const { container } = render(ProjectItem, { project, selected: true, onSelect: vi.fn() })
    expect(container.querySelector('.selected')).not.toBeNull()
  })
})
