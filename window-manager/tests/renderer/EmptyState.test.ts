import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import EmptyState from '../../src/renderer/src/components/EmptyState.svelte'

describe('EmptyState', () => {
  afterEach(() => cleanup())

  it('renders the heading text', () => {
    render(EmptyState)
    expect(screen.getByText('No window selected')).toBeDefined()
  })

  it('renders the hint text', () => {
    render(EmptyState)
    expect(screen.getByText(/Create or select a window from the sidebar/i)).toBeDefined()
  })
})
