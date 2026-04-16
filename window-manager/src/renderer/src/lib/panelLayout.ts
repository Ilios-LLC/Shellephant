import { writable } from 'svelte/store'

export type PanelId = 'claude' | 'terminal' | 'editor'

export interface PanelConfig {
  id: PanelId
  visible: boolean
  width: number
}

export interface PanelLayout {
  panels: PanelConfig[]
}

const DEFAULT_LAYOUT: PanelLayout = {
  panels: [
    { id: 'claude',   visible: true,  width: 50 },
    { id: 'terminal', visible: false, width: 0  },
    { id: 'editor',   visible: true,  width: 50 }
  ]
}

const STORAGE_KEY = 'panelLayout'

function saveLayout(layout: PanelLayout): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
}

const { subscribe, update, set } = writable<PanelLayout>(
  structuredClone(DEFAULT_LAYOUT)
)

export const panelLayout = { subscribe }

export function savePanelLayout(): void {
  let current!: PanelLayout
  const unsub = panelLayout.subscribe(v => { current = v })
  unsub()
  saveLayout(current)
}

export function togglePanel(id: PanelId): void {
  update(layout => {
    const panels = layout.panels.map(p => ({ ...p }))
    const target = panels.find(p => p.id === id)!
    const visible = panels.filter(p => p.visible)

    if (target.visible) {
      if (visible.length <= 1) return layout
      const remaining = visible.filter(p => p.id !== id)
      const total = remaining.reduce((s, p) => s + p.width, 0)
      remaining.forEach(p => {
        p.width = total === 0 ? 100 / remaining.length : p.width + target.width * p.width / total
      })
      target.visible = false
      target.width = 0
    } else {
      const newCount = visible.length + 1
      const newWidth = 100 / newCount
      const scale = (100 - newWidth) / 100
      visible.forEach(p => { p.width *= scale })
      target.visible = true
      target.width = newWidth
    }

    const next = { panels }
    saveLayout(next)
    return next
  })
}

export function resizePanels(leftId: PanelId, delta: number): void {
  update(layout => {
    const panels = layout.panels.map(p => ({ ...p }))
    const vis = panels.filter(p => p.visible)
    const li = vis.findIndex(p => p.id === leftId)
    if (li === -1 || li === vis.length - 1) return layout

    const left = vis[li]
    const right = vis[li + 1]
    const min = 1
    const actual = Math.min(left.width - min, Math.max(-(right.width - min), delta))
    left.width += actual
    right.width -= actual
    return { panels }
  })
}

export function reorderPanels(draggedId: PanelId, targetId: PanelId): void {
  if (draggedId === targetId) return
  update(layout => {
    const panels = layout.panels.map(p => ({ ...p }))
    const fi = panels.findIndex(p => p.id === draggedId)
    const ti = panels.findIndex(p => p.id === targetId)
    if (fi === -1 || ti === -1) return layout
    ;[panels[fi], panels[ti]] = [panels[ti], panels[fi]]
    const next = { panels }
    saveLayout(next)
    return next
  })
}

export function _resetForTest(layout?: PanelLayout): void {
  set(layout ?? structuredClone(DEFAULT_LAYOUT))
}
