import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import EmptyState from '../../src/renderer/src/components/EmptyState.svelte'

describe('EmptyState', () => {
  afterEach(() => cleanup())

  it('renders the heading', () => {
    render(EmptyState)
    expect(screen.getByText(/no project selected/i)).toBeDefined()
  })

  it('renders the hint', () => {
    render(EmptyState)
    expect(screen.getByText(/add a project/i)).toBeDefined()
  })
})
