import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import StatusBar from '../../src/renderer/src/components/StatusBar.svelte'

afterEach(() => cleanup())

describe('StatusBar', () => {
  it('renders line and column numbers', () => {
    render(StatusBar, { props: { line: 12, column: 4, language: 'typescript', isDirty: false } })
    expect(screen.getByText('Ln 12, Col 4')).toBeInTheDocument()
  })

  it('renders language name', () => {
    render(StatusBar, { props: { line: 1, column: 1, language: 'python', isDirty: false } })
    expect(screen.getByText('python')).toBeInTheDocument()
  })

  it('shows dirty dot when isDirty is true', () => {
    render(StatusBar, { props: { line: 1, column: 1, language: 'ts', isDirty: true } })
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument()
  })

  it('hides dirty dot when isDirty is false', () => {
    render(StatusBar, { props: { line: 1, column: 1, language: 'ts', isDirty: false } })
    expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument()
  })
})
