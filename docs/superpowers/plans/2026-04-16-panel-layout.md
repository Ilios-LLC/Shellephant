# Panel Layout: Toggle, Resize, Reorder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-panel tab-switching in TerminalHost with a toggleable, resizable, drag-to-reorder split-pane layout persisted to localStorage.

**Architecture:** A new `panelLayout` Svelte store owns layout state (panel order, visibility, widths). `TerminalHost` renders panels side-by-side in a flex row with `ResizeHandle` components between adjacent visible panels and a drag handle in each panel header. `WindowDetailPane` toggle buttons call `togglePanel` from the store directly.

**Tech Stack:** Svelte 5 runes, HTML5 Drag API, Pointer Events API, localStorage, svelte/store

---

### Task 1: panelLayout store

**Files:**
- Create: `window-manager/src/renderer/src/lib/panelLayout.ts`
- Create: `window-manager/tests/renderer/panelLayout.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// window-manager/tests/renderer/panelLayout.test.ts
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/panelLayout.test.ts 2>&1 | tail -10
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement panelLayout.ts**

```typescript
// window-manager/src/renderer/src/lib/panelLayout.ts
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
```

- [ ] **Step 4: Run tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/panelLayout.test.ts 2>&1 | tail -10
```
Expected: All pass

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window/window-manager && git add src/renderer/src/lib/panelLayout.ts tests/renderer/panelLayout.test.ts && git commit -m "feat(panelLayout): add layout store with toggle, resize, reorder, persistence"
```

---

### Task 2: ResizeHandle component

**Files:**
- Create: `window-manager/src/renderer/src/components/ResizeHandle.svelte`
- Create: `window-manager/tests/renderer/ResizeHandle.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// window-manager/tests/renderer/ResizeHandle.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import ResizeHandle from '../../src/renderer/src/components/ResizeHandle.svelte'

afterEach(cleanup)

describe('ResizeHandle', () => {
  it('renders a separator element', () => {
    render(ResizeHandle, { props: { containerWidth: 1000, onResize: vi.fn(), onResizeEnd: vi.fn() } })
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('calls onResize with positive delta on rightward pointer move', async () => {
    const onResize = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize, onResizeEnd: vi.fn() } })
    const el = screen.getByRole('separator')
    await fireEvent.pointerDown(el, { clientX: 100 })
    await fireEvent.pointerMove(el, { clientX: 110 })
    expect(onResize).toHaveBeenCalledWith(1) // (10/1000)*100
  })

  it('calls onResize with negative delta on leftward pointer move', async () => {
    const onResize = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize, onResizeEnd: vi.fn() } })
    const el = screen.getByRole('separator')
    await fireEvent.pointerDown(el, { clientX: 100 })
    await fireEvent.pointerMove(el, { clientX: 90 })
    expect(onResize).toHaveBeenCalledWith(-1) // (-10/1000)*100
  })

  it('does not call onResize before pointerdown', async () => {
    const onResize = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize, onResizeEnd: vi.fn() } })
    await fireEvent.pointerMove(screen.getByRole('separator'), { clientX: 200 })
    expect(onResize).not.toHaveBeenCalled()
  })

  it('calls onResizeEnd on pointerup after drag', async () => {
    const onResizeEnd = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize: vi.fn(), onResizeEnd } })
    const el = screen.getByRole('separator')
    await fireEvent.pointerDown(el, { clientX: 100 })
    await fireEvent.pointerUp(el)
    expect(onResizeEnd).toHaveBeenCalled()
  })

  it('does not call onResizeEnd on pointerup with no prior pointerdown', async () => {
    const onResizeEnd = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize: vi.fn(), onResizeEnd } })
    await fireEvent.pointerUp(screen.getByRole('separator'))
    expect(onResizeEnd).not.toHaveBeenCalled()
  })

  it('stops calling onResize after pointerup', async () => {
    const onResize = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize, onResizeEnd: vi.fn() } })
    const el = screen.getByRole('separator')
    await fireEvent.pointerDown(el, { clientX: 100 })
    await fireEvent.pointerUp(el)
    onResize.mockClear()
    await fireEvent.pointerMove(el, { clientX: 200 })
    expect(onResize).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/ResizeHandle.test.ts 2>&1 | tail -10
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement ResizeHandle.svelte**

```svelte
<!-- window-manager/src/renderer/src/components/ResizeHandle.svelte -->
<script lang="ts">
  interface Props {
    containerWidth: number
    onResize: (deltaPercent: number) => void
    onResizeEnd: () => void
  }

  let { containerWidth, onResize, onResizeEnd }: Props = $props()

  let dragging = false
  let startX = 0

  function handlePointerDown(e: PointerEvent): void {
    dragging = true
    startX = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!dragging) return
    const dx = e.clientX - startX
    startX = e.clientX
    if (containerWidth > 0) onResize((dx / containerWidth) * 100)
  }

  function handlePointerUp(): void {
    if (!dragging) return
    dragging = false
    onResizeEnd()
  }
</script>

<div
  class="resize-handle"
  role="separator"
  aria-label="resize panels"
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
></div>

<style>
  .resize-handle {
    width: 4px;
    flex-shrink: 0;
    background: var(--border);
    cursor: col-resize;
    transition: background 0.1s;
  }
  .resize-handle:hover {
    background: var(--accent);
  }
</style>
```

- [ ] **Step 4: Run tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/ResizeHandle.test.ts 2>&1 | tail -10
```
Expected: All pass

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window/window-manager && git add src/renderer/src/components/ResizeHandle.svelte tests/renderer/ResizeHandle.test.ts && git commit -m "feat(ResizeHandle): add resizable panel divider component"
```

---

### Task 3: WindowDetailPane — toggle buttons consuming panelLayout store

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Modify: `window-manager/tests/renderer/WindowDetailPane.test.ts`

- [ ] **Step 1: Update failing tests**

At the top of `WindowDetailPane.test.ts`, add before the existing imports:

```typescript
import { writable } from 'svelte/store'

const mockPanelLayoutStore = writable({
  panels: [
    { id: 'claude',   visible: true,  width: 50 },
    { id: 'terminal', visible: false, width: 0  },
    { id: 'editor',   visible: true,  width: 50 }
  ]
})
const mockTogglePanel = vi.fn()

vi.mock('../../src/renderer/src/lib/panelLayout', () => ({
  panelLayout: { subscribe: (...args: unknown[]) => mockPanelLayoutStore.subscribe(args[0] as Parameters<typeof mockPanelLayoutStore.subscribe>[0]) },
  togglePanel: (...args: unknown[]) => mockTogglePanel(...args)
}))
```

Replace the `beforeEach` mock setup to also reset the store:

```typescript
beforeEach(() => {
  vi.useFakeTimers()
  getCurrentBranch.mockReset()
  sendTerminalInput.mockReset()
  getGitStatus.mockReset()
  getGitStatus.mockResolvedValue({ isDirty: false, added: 0, deleted: 0 })
  mockTogglePanel.mockReset()
  mockPanelLayoutStore.set({
    panels: [
      { id: 'claude',   visible: true,  width: 50 },
      { id: 'terminal', visible: false, width: 0  },
      { id: 'editor',   visible: true,  width: 50 }
    ]
  })
  // @ts-expect-error test bridge
  globalThis.window.api = { getCurrentBranch, sendTerminalInput, getGitStatus }
})
```

Delete these two existing tests (they relied on `viewMode` and `onViewChange` props which are removed):
- `'marks the active viewMode button with aria-pressed'`
- `'calls onViewChange with the clicked mode'`

Add these new tests inside `describe('WindowDetailPane')`:

```typescript
  it('claude button aria-pressed true when claude visible in store', () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /^claude$/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^terminal$/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^editor$/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('calling togglePanel when a toggle button is clicked', async () => {
    getCurrentBranch.mockResolvedValue('main')
    render(WindowDetailPane, { props: { win, project } })
    await fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
    expect(mockTogglePanel).toHaveBeenCalledWith('terminal')
  })

  it('toggle button disabled when it is the only visible panel', () => {
    getCurrentBranch.mockResolvedValue('main')
    mockPanelLayoutStore.set({
      panels: [
        { id: 'claude',   visible: true,  width: 100 },
        { id: 'terminal', visible: false, width: 0   },
        { id: 'editor',   visible: false, width: 0   }
      ]
    })
    render(WindowDetailPane, { props: { win, project } })
    expect(screen.getByRole('button', { name: /^claude$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^terminal$/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /^editor$/i })).not.toBeDisabled()
  })
```

- [ ] **Step 2: Run tests to confirm failures**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/WindowDetailPane.test.ts 2>&1 | tail -15
```
Expected: Multiple FAILs (viewMode prop removed, togglePanel not wired)

- [ ] **Step 3: Update WindowDetailPane.svelte**

Replace the `<script>` section with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { ProjectRecord, WindowRecord } from '../types'
  import type { ConversationSummary } from '../lib/conversationSummary'
  import { panelLayout, togglePanel } from '../lib/panelLayout'
  import type { PanelId } from '../lib/panelLayout'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
    onCommit?: () => void
    onPush?: () => void
    onDelete?: () => void
    commitDisabled?: boolean
    pushDisabled?: boolean
    deleteDisabled?: boolean
    summary?: ConversationSummary
    onGitStatus?: (status: { isDirty: boolean; added: number; deleted: number } | null) => void
  }

  let {
    win,
    project,
    onCommit = () => {},
    onPush = () => {},
    onDelete,
    commitDisabled = true,
    pushDisabled = true,
    deleteDisabled = false,
    summary = undefined,
    onGitStatus = () => {}
  }: Props = $props()

  const panelVisible = $derived({
    claude:   $panelLayout.panels.find(p => p.id === 'claude')?.visible   ?? false,
    terminal: $panelLayout.panels.find(p => p.id === 'terminal')?.visible ?? false,
    editor:   $panelLayout.panels.find(p => p.id === 'editor')?.visible   ?? false
  })
  const visibleCount = $derived(
    Object.values(panelVisible).filter(Boolean).length
  )

  function handleToggle(id: PanelId): void {
    togglePanel(id)
  }

  let deleteArmed = $state(false)
  let armTimer: ReturnType<typeof setTimeout> | undefined

  function handleDelete(): void {
    if (!deleteArmed) {
      deleteArmed = true
      if (armTimer) clearTimeout(armTimer)
      armTimer = setTimeout(() => {
        deleteArmed = false
        armTimer = undefined
      }, 3000)
      return
    }
    clearTimeout(armTimer)
    armTimer = undefined
    deleteArmed = false
    onDelete?.()
  }

  onDestroy(() => {
    if (armTimer) clearTimeout(armTimer)
  })

  let branch = $state('…')
  let gitStatus = $state<{ isDirty: boolean; added: number; deleted: number } | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined
  let alive = true

  function parsePortsJson(raw: string | undefined): [string, string][] {
    if (!raw) return []
    try {
      return Object.entries(JSON.parse(raw)) as [string, string][]
    } catch {
      return []
    }
  }

  let parsedPorts: [string, string][] = $derived(parsePortsJson(win.ports))

  async function refreshBranch(): Promise<void> {
    let next: string | null = null
    try {
      next = await window.api.getCurrentBranch(win.id)
    } catch {
      // keep last-known branch on error
    }
    if (alive && next) branch = next

    try {
      const status = await window.api.getGitStatus(win.id)
      if (alive) {
        gitStatus = status
        onGitStatus(status)
      }
    } catch {
      // keep last-known status on error
    }
  }

  onMount(() => {
    void refreshBranch()
    timer = setInterval(refreshBranch, 5000)
  })
  onDestroy(() => {
    alive = false
    if (timer) clearInterval(timer)
  })
</script>
```

Replace the toggle-row HTML with:

```svelte
  <div class="toggle-row">
    {#each (['claude', 'terminal', 'editor'] as const) as id}
      <button
        type="button"
        class="toggle-btn"
        class:active={panelVisible[id]}
        aria-pressed={panelVisible[id]}
        disabled={visibleCount <= 1 && panelVisible[id]}
        onclick={() => handleToggle(id)}
      >{id === 'claude' ? 'Claude' : id === 'terminal' ? 'Terminal' : 'Editor'}</button>
    {/each}
  </div>
```

- [ ] **Step 4: Run tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/WindowDetailPane.test.ts 2>&1 | tail -15
```
Expected: All pass

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window/window-manager && git add src/renderer/src/components/WindowDetailPane.svelte tests/renderer/WindowDetailPane.test.ts && git commit -m "feat(WindowDetailPane): replace viewMode tabs with panelLayout toggle buttons"
```

---

### Task 4: TerminalHost — split-pane layout

**Files:**
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte`
- Modify: `window-manager/tests/renderer/TerminalHost.test.ts`

- [ ] **Step 1: Add panelLayout + ResizeHandle mocks to TerminalHost.test.ts**

Add at the top of the file, before the existing `vi.mock` calls:

```typescript
import { writable } from 'svelte/store'

const mockPanelLayoutStore = writable({
  panels: [
    { id: 'claude',   visible: true,  width: 50 },
    { id: 'terminal', visible: false, width: 0  },
    { id: 'editor',   visible: true,  width: 50 }
  ]
})
const mockTogglePanel = vi.fn()
const mockResizePanels = vi.fn()
const mockReorderPanels = vi.fn()
const mockSavePanelLayout = vi.fn()

vi.mock('../../src/renderer/src/lib/panelLayout', () => ({
  panelLayout: {
    subscribe: (...args: unknown[]) =>
      mockPanelLayoutStore.subscribe(args[0] as Parameters<typeof mockPanelLayoutStore.subscribe>[0])
  },
  togglePanel: (...args: unknown[]) => mockTogglePanel(...args),
  resizePanels: (...args: unknown[]) => mockResizePanels(...args),
  reorderPanels: (...args: unknown[]) => mockReorderPanels(...args),
  savePanelLayout: () => mockSavePanelLayout()
}))

vi.mock('../../src/renderer/src/components/ResizeHandle.svelte', () => ({
  default: vi.fn(() => ({}))
}))
```

Add to `beforeEach` (inside the `describe('TerminalHost')`):

```typescript
    mockPanelLayoutStore.set({
      panels: [
        { id: 'claude',   visible: true,  width: 50 },
        { id: 'terminal', visible: false, width: 0  },
        { id: 'editor',   visible: true,  width: 50 }
      ]
    })
    mockTogglePanel.mockReset()
    mockResizePanels.mockReset()
    mockReorderPanels.mockReset()
    mockSavePanelLayout.mockReset()
```

- [ ] **Step 2: Delete/replace broken tests and add new ones**

Delete these tests (behavior changed):
- `'Claude toggle button is active (aria-pressed true) by default'` — now in WindowDetailPane
- `'hides claude terminal div when Editor mode is active'` — no more `.hidden` class

Replace `'opens terminal session on first click of Terminal button'` with:

```typescript
  it('opens terminal session when terminal panel becomes visible in store', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    mockApi.openTerminal.mockClear()

    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p =>
        p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p
      )
    }))

    await vi.waitFor(() => {
      expect(mockApi.openTerminal).toHaveBeenCalledWith(
        'container123abc', expect.any(Number), expect.any(Number), 'host-test', 'terminal'
      )
    })
  })
```

Replace `'does not re-open terminal session on subsequent Terminal clicks'` with:

```typescript
  it('does not re-open terminal session on second visibility change', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())

    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p)
    }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some(c => c[4] === 'terminal')).toBe(true)
    })
    mockApi.openTerminal.mockClear()

    // Hide and re-show terminal
    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: false, width: 0 } : p)
    }))
    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p)
    }))

    await new Promise(r => setTimeout(r, 10))
    expect(mockApi.openTerminal).not.toHaveBeenCalled()
  })
```

For `'routes onTerminalData to terminal session when sessionType is terminal'`, replace the "Switch to terminal" comment block with store update:

```typescript
    // Make terminal visible to trigger initTerminalSession
    mockPanelLayoutStore.update(layout => ({
      panels: layout.panels.map(p => p.id === 'terminal' ? { ...p, visible: true, width: 33 } : p)
    }))
    await vi.waitFor(() => {
      const calls = mockApi.openTerminal.mock.calls as unknown[][]
      expect(calls.some(c => c[4] === 'terminal')).toBe(true)
    })
```

Add new structural tests:

```typescript
  it('renders claude panel by default', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    expect(document.querySelector('[data-panel-id="claude"]')).toBeTruthy()
  })

  it('does not render terminal panel when hidden in store', async () => {
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    expect(document.querySelector('[data-panel-id="terminal"]')).toBeNull()
  })

  it('renders terminal panel when visible in store', async () => {
    mockPanelLayoutStore.set({
      panels: [
        { id: 'claude',   visible: true, width: 50 },
        { id: 'terminal', visible: true, width: 25 },
        { id: 'editor',   visible: true, width: 25 }
      ]
    })
    render(TerminalHost, { win: mockWindow, project: mockProject })
    await vi.waitFor(() => expect(mockApi.openTerminal).toHaveBeenCalled())
    expect(document.querySelector('[data-panel-id="terminal"]')).toBeTruthy()
  })
```

- [ ] **Step 3: Run tests to confirm expected failures**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/TerminalHost.test.ts 2>&1 | tail -20
```
Expected: Structural tests FAIL (TerminalHost not yet rewritten)

- [ ] **Step 4: Rewrite TerminalHost.svelte**

Replace the entire file with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal as XTerm } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { WebLinksAddon } from '@xterm/addon-web-links'
  import '@xterm/xterm/css/xterm.css'
  import type { ProjectRecord, WindowRecord } from '../types'
  import WindowDetailPane from './WindowDetailPane.svelte'
  import EditorPane from './EditorPane.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import CommitModal from './CommitModal.svelte'
  import { pushToast, pushSuccessModal } from '../lib/toasts'
  import { waitingWindows } from '../lib/waitingWindows'
  import { conversationSummary } from '../lib/conversationSummary'
  import { panelLayout, resizePanels, reorderPanels, savePanelLayout } from '../lib/panelLayout'
  import type { PanelId } from '../lib/panelLayout'

  interface Props {
    win: WindowRecord
    project: ProjectRecord
    onWindowDeleted?: (id: number) => void
  }

  let { win, project, onWindowDeleted = () => {} }: Props = $props()

  const rootPath = $derived('/workspace/' + (project.git_url.split('/').pop() ?? 'unknown').replace(/\.git$/, ''))

  // Claude terminal
  let claudeTerminalEl: HTMLDivElement
  let claudeTerm: XTerm | undefined
  let claudeFitAddon: FitAddon | undefined
  let claudeResizeObserver: ResizeObserver | undefined

  // Terminal session (lazy)
  let terminalEl: HTMLDivElement
  let term: XTerm | undefined
  let fitAddon: FitAddon | undefined
  let resizeObserver: ResizeObserver | undefined
  let terminalOpened = false

  let commitOpen = $state(false)
  let commitBusy = $state(false)
  let pushBusy = $state(false)
  let deleteBusy = $state(false)
  let gitStatus = $state<{ isDirty: boolean; added: number; deleted: number } | null>(null)

  let contentAreaWidth = $state(0)
  let draggedPanelId: PanelId | null = null

  const visiblePanels = $derived($panelLayout.panels.filter(p => p.visible))

  const xtermOptions = {
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    theme: {
      background: '#09090b',
      foreground: '#fafafa',
      cursor: '#8b5cf6',
      selectionBackground: '#3f3f46'
    },
    scrollback: 1000
  }

  function initTerminalSession(): void {
    terminalOpened = true
    term = new XTerm(xtermOptions)
    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(terminalEl)
    term.reset()
    resizeObserver = new ResizeObserver(() => fitAddon?.fit())
    resizeObserver.observe(terminalEl)
    window.api.openTerminal(win.container_id, term.cols, term.rows, win.name, 'terminal')
    term.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data, 'terminal')
      waitingWindows.remove(win.container_id)
    })
    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows, 'terminal')
    })
  }

  async function runCommit(v: { subject: string; body: string }): Promise<void> {
    commitBusy = true
    try {
      const res = await window.api.commit(win.id, { subject: v.subject, body: v.body || undefined })
      if (res.ok) {
        const subjectLine = res.stdout.split('\n').find((l: string) => /^\[.+\]/.test(l))
        pushToast({ level: 'success', title: 'Committed', body: subjectLine })
      } else {
        const nothing = /nothing to commit/i.test(res.stdout)
        pushToast({
          level: nothing ? 'success' : 'error',
          title: nothing ? 'Nothing to commit' : 'Commit failed',
          body: nothing ? undefined : res.stdout
        })
      }
      commitOpen = false
    } catch (err) {
      pushToast({ level: 'error', title: 'Commit error', body: (err as Error).message })
    } finally {
      commitBusy = false
    }
  }

  async function runPush(): Promise<void> {
    pushBusy = true
    try {
      const res = await window.api.push(win.id)
      if (res.ok) {
        pushSuccessModal(res.prUrl)
      } else {
        pushToast({ level: 'error', title: 'Push failed', body: res.stdout || undefined })
      }
    } catch (err) {
      pushToast({ level: 'error', title: 'Push error', body: (err as Error).message })
    } finally {
      pushBusy = false
    }
  }

  async function runDelete(): Promise<void> {
    if (deleteBusy) return
    deleteBusy = true
    try {
      await window.api.deleteWindow(win.id)
      onWindowDeleted(win.id)
    } catch (err) {
      pushToast({ level: 'error', title: 'Delete failed', body: (err as Error).message })
      deleteBusy = false
    }
  }

  onMount(() => {
    claudeTerm = new XTerm(xtermOptions)
    claudeFitAddon = new FitAddon()
    claudeTerm.loadAddon(claudeFitAddon)
    claudeTerm.loadAddon(new WebLinksAddon())
    claudeTerm.open(claudeTerminalEl)
    claudeFitAddon.fit()
    claudeTerm.reset()
    claudeResizeObserver = new ResizeObserver(() => claudeFitAddon?.fit())
    claudeResizeObserver.observe(claudeTerminalEl)
    window.api.openTerminal(win.container_id, claudeTerm.cols, claudeTerm.rows, win.name, 'claude')
    claudeTerm.onData((data: string) => {
      window.api.sendTerminalInput(win.container_id, data, 'claude')
      waitingWindows.remove(win.container_id)
    })
    claudeTerm.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.api.resizeTerminal(win.container_id, cols, rows, 'claude')
    })

    window.api.onTerminalData((containerId: string, sessionType: string, data: string) => {
      if (containerId !== win.container_id) return
      if (sessionType === 'claude') claudeTerm?.write(data)
      else term?.write(data)
    })

    window.api.onTerminalSummary(({ containerId, title, bullets }: { containerId: string; title: string; bullets: string[] }) => {
      if (containerId === win.container_id) {
        conversationSummary.set(containerId, { title, bullets })
      }
    })
  })

  onDestroy(() => {
    claudeResizeObserver?.disconnect()
    resizeObserver?.disconnect()
    window.api.offTerminalData()
    window.api.closeTerminal(win.container_id, 'claude')
    if (terminalOpened) window.api.closeTerminal(win.container_id, 'terminal')
    waitingWindows.remove(win.container_id)
    window.api.offTerminalSummary()
    conversationSummary.remove(win.container_id)
    claudeTerm?.dispose()
    term?.dispose()
  })

  $effect(() => {
    const panels = $panelLayout.panels
    const termPanel = panels.find(p => p.id === 'terminal')
    const claudePanel = panels.find(p => p.id === 'claude')

    // Re-attach if panel was toggled off then on — element is re-created empty by Svelte
    if (claudePanel?.visible && claudeTerminalEl && claudeTerm && !claudeTerminalEl.hasChildNodes()) {
      claudeTerm.open(claudeTerminalEl)
    }
    if (claudePanel?.visible) claudeFitAddon?.fit()

    if (termPanel?.visible) {
      if (!terminalOpened) {
        initTerminalSession()
      } else {
        if (terminalEl && term && !terminalEl.hasChildNodes()) term.open(terminalEl)
        fitAddon?.fit()
      }
    }
  })
</script>

<section class="terminal-host">
  <div class="content-area" bind:clientWidth={contentAreaWidth}>
    {#each visiblePanels as panel, i (panel.id)}
      <div
        class="panel"
        data-panel-id={panel.id}
        style="width: {panel.width}%; min-width: 150px"
        ondragover={(e) => e.preventDefault()}
        ondrop={() => { if (draggedPanelId !== null && draggedPanelId !== panel.id) reorderPanels(draggedPanelId, panel.id) }}
        role="region"
        aria-label={panel.id}
      >
        <div class="panel-header">
          <span class="panel-title">{panel.id === 'claude' ? 'Claude' : panel.id === 'terminal' ? 'Terminal' : 'Editor'}</span>
          <span
            class="drag-handle"
            draggable="true"
            role="button"
            tabindex="0"
            aria-label="drag to reorder {panel.id}"
            ondragstart={() => { draggedPanelId = panel.id }}
            ondragend={() => { draggedPanelId = null }}
          >⠿</span>
        </div>
        <div class="panel-body">
          {#if panel.id === 'claude'}
            <div class="terminal-inner" bind:this={claudeTerminalEl}></div>
          {:else if panel.id === 'terminal'}
            <div class="terminal-inner" bind:this={terminalEl}></div>
          {:else if panel.id === 'editor'}
            <EditorPane containerId={win.container_id} {rootPath} />
          {/if}
        </div>
      </div>
      {#if i < visiblePanels.length - 1}
        <ResizeHandle
          containerWidth={contentAreaWidth}
          onResize={(delta) => resizePanels(panel.id, delta)}
          onResizeEnd={savePanelLayout}
        />
      {/if}
    {/each}
  </div>
  <WindowDetailPane
    {win}
    {project}
    summary={$conversationSummary.get(win.container_id)}
    onCommit={() => (commitOpen = true)}
    onPush={runPush}
    onDelete={runDelete}
    onGitStatus={(s) => (gitStatus = s)}
    commitDisabled={commitBusy || pushBusy || deleteBusy || !gitStatus?.isDirty}
    pushDisabled={commitBusy || pushBusy || deleteBusy}
    deleteDisabled={deleteBusy}
  />
  {#if commitOpen}
    <CommitModal
      initialSubject={$conversationSummary.get(win.container_id)?.title ?? ''}
      initialBody={$conversationSummary.get(win.container_id)?.bullets.join('\n') ?? ''}
      onSubmit={runCommit}
      onCancel={() => (commitOpen = false)}
      busy={commitBusy}
    />
  {/if}
</section>

<style>
  .terminal-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
  }

  .content-area {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.2rem 0.5rem;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--fg-2);
    user-select: none;
  }

  .drag-handle {
    cursor: grab;
    padding: 0 0.2rem;
    color: var(--fg-3);
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .panel-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .terminal-inner {
    flex: 1;
    overflow: hidden;
    padding: 0.5rem;
  }
</style>
```

- [ ] **Step 5: Run all tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/TerminalHost.test.ts 2>&1 | tail -20
```
Expected: All pass

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
cd /workspace/claude-window/window-manager && npx vitest run 2>&1 | tail -20
```
Expected: All pass

- [ ] **Step 7: Commit**

```bash
cd /workspace/claude-window/window-manager && git add src/renderer/src/components/TerminalHost.svelte tests/renderer/TerminalHost.test.ts && git commit -m "feat(TerminalHost): replace tab switching with split-pane layout"
```

---

### Task 5: Update CLAUDE.md

**Files:**
- Modify: `/home/node/.claude/CLAUDE.md`

- [ ] **Step 1: Update the Codebase Structure section**

In the `## Codebase Structure` section, add the new entries and update the changed ones:

Add after the existing `GroupStrip.svelte` entry:

```
### window-manager/src/renderer/src/lib/panelLayout.ts
Svelte store managing panel layout state (order, visibility, widths).
- Types: `PanelId = 'claude' | 'terminal' | 'editor'`, `PanelConfig`, `PanelLayout`
- Default: claude(50%,visible), terminal(0%,hidden), editor(50%,visible)
- Exports: `panelLayout` (readable store), `togglePanel(id)`, `resizePanels(leftId, delta)`, `reorderPanels(draggedId, targetId)`, `savePanelLayout()`, `_resetForTest(layout?)`
- `resizePanels` does NOT save — call `savePanelLayout()` separately on drag end
- Tests: `window-manager/tests/renderer/panelLayout.test.ts`

### window-manager/src/renderer/src/components/ResizeHandle.svelte
Thin vertical drag handle (4px) between adjacent visible panels.
- Props: `containerWidth: number`, `onResize: (deltaPercent: number) => void`, `onResizeEnd: () => void`
- Uses `dragging` boolean (not pointer capture checks) for testability
- Tests: `window-manager/tests/renderer/ResizeHandle.test.ts`
```

Update the `TerminalHost.svelte` entry to:

```
### window-manager/src/renderer/src/components/TerminalHost.svelte
Renders all three panels (Claude, Terminal, Editor) side-by-side in a flex row.
- Reads `$panelLayout` store for visibility/width/order; renders only visible panels
- Each visible panel has a header with title + `⠿` drag handle (HTML5 drag API)
- ResizeHandle rendered between adjacent visible panels
- Terminal session lazy-inits via `$effect` watching `$panelLayout` (not on click)
- `data-panel-id` attribute on each panel div for testability
- Tests: `window-manager/tests/renderer/TerminalHost.test.ts`
```

Update the `WindowDetailPane.svelte` entry to:

```
### window-manager/src/renderer/src/components/WindowDetailPane.svelte
Footer bar with panel toggles, git status, and action buttons.
- Imports `panelLayout` store and `togglePanel` directly (no viewMode/onViewChange props)
- Toggle buttons: active = panel visible, disabled = last visible panel
- Tests: `window-manager/tests/renderer/WindowDetailPane.test.ts`
```

- [ ] **Step 2: Commit**

```bash
git add /home/node/.claude/CLAUDE.md && git commit -m "docs(CLAUDE.md): update codebase structure for panel layout feature"
```
