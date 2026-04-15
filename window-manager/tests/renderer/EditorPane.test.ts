import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child components to isolate EditorPane logic
// Svelte 5 components are functions called as Component(anchor, props)
vi.mock('../../src/renderer/src/components/FileTree.svelte', () => ({
  default: vi.fn(() => ({}))
}))

vi.mock('../../src/renderer/src/components/MonacoEditor.svelte', () => ({
  default: vi.fn(() => ({}))
}))

import EditorPane from '../../src/renderer/src/components/EditorPane.svelte'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EditorPane', () => {
  it('shows a placeholder when no file is selected', () => {
    render(EditorPane, { containerId: 'ctr', rootPath: '/workspace/r' })
    expect(screen.getByText(/select a file/i)).toBeInTheDocument()
  })
})
