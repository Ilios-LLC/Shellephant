# Panel Layout: Toggle, Resize, Reorder

**Date:** 2026-04-16  
**Branch:** window-rearranging  
**Status:** Approved

## Overview

Replace the single-panel tab-switching system in `TerminalHost.svelte` with a flexible side-by-side split-pane layout. All three panels (Claude, Terminal, Editor) can be visible simultaneously, toggled on/off, resized via drag handles, and reordered via drag-and-drop. Layout preferences persist globally to `localStorage`.

## Scope

**In scope:**
- Toggle panel visibility (Claude, Terminal, Editor)
- Drag divider to resize adjacent panels
- Drag grab handle to reorder panels
- Persist layout globally (one layout for all windows/projects)

**Out of scope:**
- Per-project or per-window layout
- Vertical split orientation
- Panel detach/float

## Data Model

```typescript
// window-manager/src/renderer/src/lib/panelLayout.ts

interface PanelConfig {
  id: 'claude' | 'terminal' | 'editor'
  visible: boolean
  width: number  // percentage of container width; visible panels sum to 100
}

interface PanelLayout {
  panels: PanelConfig[]  // array order = left-to-right render order
}
```

**Default state:**
```typescript
const DEFAULT_LAYOUT: PanelLayout = {
  panels: [
    { id: 'claude',    visible: true,  width: 50 },
    { id: 'terminal',  visible: false, width: 0  },
    { id: 'editor',    visible: true,  width: 50 },
  ]
}
```

**Persistence:** `localStorage.setItem('panelLayout', JSON.stringify(layout))` on every change. Read on store init; fall back to default if missing or invalid.

## Width Rules

- Visible panel widths always sum to 100%
- Minimum panel width: 150px (enforced via CSS `min-width` and clamped during resize drag)
- **Toggle off:** redistribute the hidden panel's width proportionally among remaining visible panels
- **Toggle on:** give new panel an equal share; shrink others proportionally
- **Reorder:** widths travel with their panels; no recalculation

## Components

### New: `lib/panelLayout.ts`
Svelte store owning `PanelLayout` state. Exports:
- `panelLayout` — readable/writable store
- `togglePanel(id)` — show/hide panel, redistribute widths
- `resizePanels(leftId, delta)` — adjust two adjacent panels by delta (percentage), clamped
- `reorderPanels(draggedId, targetId)` — swap positions in panels array
- All mutations call `saveToDisk()` → `localStorage`

### New: `components/ResizeHandle.svelte`
Props: `onResize(deltaPercent: number) => void`

- Thin vertical bar (~4px), `cursor: col-resize`
- `pointerdown` → `setPointerCapture` → track `pointermove` → compute delta as `(px moved / containerWidth) * 100` → call `onResize` → `pointerup` releases capture and saves layout

### Modified: `TerminalHost.svelte`
- Remove `viewMode` state and `.hidden` CSS class pattern
- Render a flex-row container; for each panel in `$panelLayout.panels`:
  - If `visible`: render panel div with `width: {panel.width}%` and `min-width: 150px`
  - Between adjacent visible panels: render `<ResizeHandle>`
- Each panel gets a header bar:
  - Panel title (Claude / Terminal / Editor)
  - Grab handle icon (top corner), `draggable="true"`
  - `dragstart`: set dragged panel id
  - `dragover` / `drop`: call `reorderPanels`

### Modified: `WindowDetailPane.svelte`
- Existing Claude/Terminal/Editor buttons become toggle buttons
- Button active state = `panel.visible === true`
- `onclick`: call `togglePanel(id)`
- At least one panel must remain visible: disable toggle-off if only one visible panel remains

## Behavior Details

### Resize
1. User grabs resize handle between Panel A and Panel B
2. Pointer captured; moves right by X pixels
3. `delta = (X / containerWidth) * 100`
4. `panelA.width += delta`, `panelB.width -= delta`
5. Clamp: neither panel goes below `(150 / containerWidth) * 100`
6. On `pointerup`: save to localStorage

### Reorder
1. User grabs drag icon on Panel A header
2. `dragstart` stores `'A'`
3. User drops onto Panel B
4. Swap Panel A and Panel B positions in `panels` array
5. Widths unchanged; save to localStorage

### Toggle Off (Panel A visible → hidden)
1. `panelA.visible = false`
2. Distribute `panelA.width` proportionally among remaining visible panels
3. `panelA.width = 0`
4. Save to localStorage

### Toggle On (Panel A hidden → visible)
1. Give Panel A a share: `newWidth = 100 / (visibleCount + 1)`
2. Scale existing visible panels proportionally to fill remaining `100 - newWidth`
3. `panelA.visible = true`, `panelA.width = newWidth`
4. Save to localStorage

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/lib/panelLayout.ts` | New — layout store + mutations |
| `src/renderer/src/components/ResizeHandle.svelte` | New — resize handle component |
| `src/renderer/src/components/TerminalHost.svelte` | Modified — replace viewMode with split-pane layout |
| `src/renderer/src/components/WindowDetailPane.svelte` | Modified — toggle buttons instead of exclusive tab switchers |

## Testing

- Unit tests for `panelLayout.ts`: toggle redistribution math, resize clamping, reorder swap, persistence read/write
- Component tests for `ResizeHandle.svelte`: pointer event sequence, delta calculation
- Component tests for `TerminalHost.svelte`: panels render per layout state, resize handle presence, drag events
- Component tests for `WindowDetailPane.svelte`: button active state reflects visibility, last-panel toggle disabled
