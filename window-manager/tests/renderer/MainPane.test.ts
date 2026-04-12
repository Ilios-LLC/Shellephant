import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowRecord } from '../../src/renderer/src/types'

vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = vi.fn()
    write = vi.fn()
    dispose = vi.fn()
    onData = vi.fn()
    onResize = vi.fn()
    loadAddon = vi.fn()
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
  }
  return { FitAddon }
})

vi.mock('@xterm/addon-web-links', () => {
  class WebLinksAddon {}
  return { WebLinksAddon }
})

import MainPane from '../../src/renderer/src/components/MainPane.svelte'

const winA: WindowRecord = {
  id: 1,
  name: 'alpha',
  container_id: 'abc123456789xxx',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running',
}

describe('MainPane', () => {
  beforeEach(() => {
    vi.stubGlobal('api', {
      openTerminal: vi.fn().mockResolvedValue(undefined),
      sendTerminalInput: vi.fn(),
      resizeTerminal: vi.fn(),
      closeTerminal: vi.fn(),
      onTerminalData: vi.fn(),
      offTerminalData: vi.fn(),
    })
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders EmptyState when selected is null', () => {
    render(MainPane, { selected: null })
    expect(screen.getByText('No window selected')).toBeDefined()
  })

  it('renders TerminalHost when selected is a record', () => {
    render(MainPane, { selected: winA })
    expect(screen.getByText('alpha')).toBeDefined()
  })
})
