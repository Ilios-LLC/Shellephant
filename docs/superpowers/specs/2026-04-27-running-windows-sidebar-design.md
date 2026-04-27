# Running Windows Sidebar Design

**Date:** 2026-04-27

## Problem

Sidebar currently shows projects at top and a "Waiting" section at the bottom that only appears when Claude is waiting for input. No persistent view of all running windows across projects exists in the sidebar.

## Goal

Replace the waiting-windows section with a persistent "Running Windows" section at the bottom of the sidebar. Show all running windows across all projects. Windows where Claude is waiting for input get a distinct blue gradient background instead of living in a separate list.

## Design

### New Component: `RunningWindowsSection.svelte`

**Location:** `window-manager/src/renderer/src/components/RunningWindowsSection.svelte`

**Props:**
- `allWindows: WindowRecord[]` — all windows across all projects
- `projects: ProjectRecord[]` — needed to resolve project name per window
- `onWindowSelect: (windowId: number, projectId: number) => void`

**Behavior:**
- Filters `allWindows` to `status === 'running'`
- Reads `$waitingWindows` store internally
- If no running windows: renders nothing (section hidden, no empty state)
- Each item renders: `{projectName} / {windowName}` with a small status dot
- Waiting windows (containerId in `$waitingWindows`): blue gradient background
- Clicking a waiting window: removes entry from `$waitingWindows` store, calls `onWindowSelect`
- Clicking a non-waiting running window: calls `onWindowSelect` directly
- Section header: "Running" label

**Waiting item style:**
```css
background: linear-gradient(135deg, hsla(210, 80%, 50%, 0.18), transparent);
border-left: 2px solid hsla(210, 80%, 60%, 0.6);
```

### Changes to `Sidebar.svelte`

- Remove existing waiting-windows section (`{#if $waitingWindows.length > 0}` block)
- Remove `onWaitingWindowSelect` prop
- Add `allWindows: WindowRecord[]` prop
- Add `projects: ProjectRecord[]` prop  
- Add `onWindowSelect: (windowId: number, projectId: number) => void` prop
- Render `<RunningWindowsSection>` at bottom (above group strip)

### Changes to `App.svelte`

- Pass `allWindows` to `<Sidebar>`
- Pass `projects` to `<Sidebar>` (already available as state)
- Replace `onWaitingWindowSelect` with `onWindowSelect` handler
- `onWindowSelect` handler: sets `selectedWindowId` + `selectedProjectId`, navigates to the window

## Data Flow

```
App.svelte
  allWindows (state) ──────────────────────────────┐
  projects (state) ────────────────────────────────┤
  handleWindowSelect(windowId, projectId) ──────────┤
                                                    ▼
                                              Sidebar.svelte
                                                    │
                                                    ▼
                                        RunningWindowsSection.svelte
                                          reads $waitingWindows store
                                          filters allWindows to running
                                          renders items with waiting indicator
```

## Testing

New test file: `window-manager/tests/renderer/RunningWindowsSection.test.ts`

Tests:
1. Renders nothing when no running windows
2. Renders running windows with `project / window` label
3. Waiting window gets blue gradient class
4. Non-waiting running window does not get waiting class
5. Clicking waiting item calls onWindowSelect and removes from store
6. Clicking non-waiting item calls onWindowSelect only

`Sidebar.test.ts` (existing): update to remove waiting section assertions, add running section smoke test.

## Out of Scope

- Stopped/unknown windows in the running section
- Sorting or grouping running windows by project
- Count badge on the section header
