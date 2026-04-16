import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { get } from 'svelte/store'

let store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string): string | null => store[key] ?? null,
  setItem: (key: string, value: string): void => { store[key] = value },
  removeItem: (key: string): void => { delete store[key] },
  clear: (): void => { store = {} }
}
vi.stubGlobal('localStorage', localStorageMock)

import {
  panelLayout,
  togglePanel,
  resizePanels,
  reorderPanels,
  savePanelLayout,
  _resetForTest
} from '../../src/renderer/src/lib/panelLayout'
import type { PanelLayout } from '../../src/renderer/src/lib/panelLayout'

describe('panelLayout', () => {
  beforeEach(() => {
    store = {}
    _resetForTest()
  })

  afterEach(() => vi.clearAllMocks())

  describe('default layout', () => {
    it('claude visible at 50%', () => {
      const p = get(panelLayout).panels.find(p => p.id === 'claude')!
      expect(p.visible).toBe(true)
      expect(p.width).toBeCloseTo(50)
    })

    it('terminal hidden at 0%', () => {
      const p = get(panelLayout).panels.find(p => p.id === 'terminal')!
      expect(p.visible).toBe(false)
      expect(p.width).toBe(0)
    })

    it('editor visible at 50%', () => {
      const p = get(panelLayout).panels.find(p => p.id === 'editor')!
      expect(p.visible).toBe(true)
      expect(p.width).toBeCloseTo(50)
    })

    it('order is claude, terminal, editor', () => {
      expect(get(panelLayout).panels.map(p => p.id)).toEqual(['claude', 'terminal', 'editor'])
    })
  })

  describe('localStorage load on init', () => {
    it('_resetForTest with saved layout restores that layout', () => {
      const saved: PanelLayout = {
        panels: [
          { id: 'terminal', visible: true,  width: 40 },
          { id: 'claude',   visible: true,  width: 60 },
          { id: 'editor',   visible: false, width: 0  }
        ]
      }
      _resetForTest(saved)
      expect(get(panelLayout).panels.map(p => p.id)).toEqual(['terminal', 'claude', 'editor'])
      expect(get(panelLayout).panels.find(p => p.id === 'terminal')!.width).toBeCloseTo(40)
    })

    it('falls back to default when localStorage has invalid JSON', () => {
      store['panelLayout'] = 'not-valid-json'
      _resetForTest()
      expect(get(panelLayout).panels.map(p => p.id)).toEqual(['claude', 'terminal', 'editor'])
    })
  })

  describe('togglePanel — hide', () => {
    it('hides claude, gives width to editor', () => {
      togglePanel('claude')
      const layout = get(panelLayout)
      expect(layout.panels.find(p => p.id === 'claude')!.visible).toBe(false)
      expect(layout.panels.find(p => p.id === 'claude')!.width).toBe(0)
      expect(layout.panels.find(p => p.id === 'editor')!.width).toBeCloseTo(100)
    })

    it('redistributes proportionally when 3 visible remain as 2', () => {
      togglePanel('terminal') // all 3 visible ~33% each
      togglePanel('claude')   // hide claude; terminal and editor each get ~50%
      const layout = get(panelLayout)
      const t = layout.panels.find(p => p.id === 'terminal')!
      const e = layout.panels.find(p => p.id === 'editor')!
      expect(t.width + e.width).toBeCloseTo(100)
      expect(t.width).toBeCloseTo(e.width, 0)
    })

    it('does not hide last visible panel', () => {
      togglePanel('editor')
      togglePanel('claude') // only claude left — should be no-op
      expect(get(panelLayout).panels.find(p => p.id === 'claude')!.visible).toBe(true)
    })

    it('saves to localStorage', () => {
      togglePanel('claude')
      const saved = JSON.parse(store['panelLayout']) as PanelLayout
      expect(saved.panels.find(p => p.id === 'claude')!.visible).toBe(false)
    })
  })

  describe('togglePanel — show', () => {
    it('shows terminal with equal share', () => {
      togglePanel('terminal')
      const layout = get(panelLayout)
      const t = layout.panels.find(p => p.id === 'terminal')!
      const c = layout.panels.find(p => p.id === 'claude')!
      expect(t.visible).toBe(true)
      expect(c.width + t.width + layout.panels.find(p => p.id === 'editor')!.width).toBeCloseTo(100)
    })

    it('saves to localStorage', () => {
      togglePanel('terminal')
      const saved = JSON.parse(store['panelLayout']) as PanelLayout
      expect(saved.panels.find(p => p.id === 'terminal')!.visible).toBe(true)
    })
  })

  describe('resizePanels', () => {
    it('increases left, decreases right by delta', () => {
      resizePanels('claude', 10)
      expect(get(panelLayout).panels.find(p => p.id === 'claude')!.width).toBeCloseTo(60)
      expect(get(panelLayout).panels.find(p => p.id === 'editor')!.width).toBeCloseTo(40)
    })

    it('negative delta transfers from left to right', () => {
      resizePanels('claude', -10)
      expect(get(panelLayout).panels.find(p => p.id === 'claude')!.width).toBeCloseTo(40)
      expect(get(panelLayout).panels.find(p => p.id === 'editor')!.width).toBeCloseTo(60)
    })

    it('clamps left panel to minimum 1%', () => {
      resizePanels('claude', -60)
      expect(get(panelLayout).panels.find(p => p.id === 'claude')!.width).toBeGreaterThanOrEqual(1)
    })

    it('clamps right panel to minimum 1%', () => {
      resizePanels('claude', 60)
      expect(get(panelLayout).panels.find(p => p.id === 'editor')!.width).toBeGreaterThanOrEqual(1)
    })

    it('skips hidden panels when finding right neighbor', () => {
      resizePanels('claude', 10) // terminal is hidden; right neighbor = editor
      expect(get(panelLayout).panels.find(p => p.id === 'terminal')!.width).toBe(0)
    })

    it('does nothing if leftId has no visible right neighbor', () => {
      const before = get(panelLayout).panels.find(p => p.id === 'editor')!.width
      resizePanels('editor', 10)
      expect(get(panelLayout).panels.find(p => p.id === 'editor')!.width).toBeCloseTo(before)
    })

    it('does NOT save to localStorage', () => {
      store = {}
      resizePanels('claude', 5)
      expect(store['panelLayout']).toBeUndefined()
    })
  })

  describe('savePanelLayout', () => {
    it('saves current state to localStorage', () => {
      resizePanels('claude', 10)
      store = {}
      savePanelLayout()
      const saved = JSON.parse(store['panelLayout']) as PanelLayout
      expect(saved.panels.find(p => p.id === 'claude')!.width).toBeCloseTo(60)
    })
  })

  describe('reorderPanels', () => {
    it('swaps two panels', () => {
      reorderPanels('claude', 'editor')
      expect(get(panelLayout).panels.map(p => p.id)).toEqual(['editor', 'terminal', 'claude'])
    })

    it('widths travel with panels', () => {
      reorderPanels('claude', 'editor')
      const layout = get(panelLayout)
      expect(layout.panels[0].id).toBe('editor')
      expect(layout.panels[0].width).toBeCloseTo(50)
      expect(layout.panels[2].id).toBe('claude')
      expect(layout.panels[2].width).toBeCloseTo(50)
    })

    it('no-op when dragged === target', () => {
      const before = get(panelLayout).panels.map(p => p.id)
      reorderPanels('claude', 'claude')
      expect(get(panelLayout).panels.map(p => p.id)).toEqual(before)
    })

    it('saves to localStorage', () => {
      store = {}
      reorderPanels('claude', 'editor')
      expect(store['panelLayout']).toBeTruthy()
    })
  })
})
