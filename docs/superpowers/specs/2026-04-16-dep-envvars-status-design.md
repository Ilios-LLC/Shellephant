# Dependency Env Vars + Status Indicator Design

**Date:** 2026-04-16  
**Branch:** dependency-work

## Overview

Two features:
1. Set and edit environment variables on project dependencies (both at creation and after)
2. Show running/stopped status of dependency containers in the Dep Logs dropdown selector

---

## Feature 1: Dependency Env Vars

### Background

`project_dependencies.env_vars` column already exists (JSON string). `createDependency` already accepts `envVars`. Gap: no UI to set or edit them, and no `updateDependency` IPC path.

### Data Layer

**`dependencyService.ts`** — add:
```ts
updateDependency(id: number, envVars: Record<string, string> | null): ProjectDependency
// UPDATE project_dependencies SET env_vars=? WHERE id=?
// Returns updated ProjectDependency
```

**`ipcHandlers.ts`** — add handler:
```ts
ipcMain.handle('project:dep-update', (_, id: number, envVars: Record<string, string> | null) =>
  updateDependency(id, envVars))
```

**`preload/index.ts`** — expose:
```ts
updateDependency: (id: number, envVars: Record<string, string> | null) => Promise<ProjectDependency>
  → ipcRenderer.invoke('project:dep-update', id, envVars)
```

No schema migration needed — column exists.

### UI: `DependenciesSection.svelte`

**Add form (new dep):**
- New state: `formEnvRows: { key: string; value: string }[]` (starts empty)
- Below tag input: "Env vars" label + `+` button to append a blank row
- Each row: `KEY` input + `=` separator + `VALUE` input + `×` remove button
- On save: filter rows with blank keys, convert to `Record<string,string>`, pass to `createDependency`

**Edit existing dep:**
- New state: `editingDepId: number | null`, `editRows: { key: string; value: string }[]`
- Each dep row gets an "Edit env vars" button (pencil icon or text link)
- Click → expands that dep inline with KV row editor pre-populated from `dep.env_vars`
- Opening a new edit collapses any currently open edit (only one at a time)
- Save → `window.api.updateDependency(dep.id, envVars)` → refresh dep list → collapse
- Cancel → collapse without saving
- Collapsed dep rows show no env var preview (keeps list compact)

---

## Feature 2: Dep Container Status Indicator

### Background

`WindowDetailPane` already has a `<select>` dropdown for choosing which dep container's logs to view. No indication of whether each container is running or stopped.

### Data Layer

**New file: `containerStatusService.ts`**:
```ts
export type ContainerStatus = 'running' | 'stopped' | 'unknown'

export async function getDepContainersStatus(
  containerIds: string[]
): Promise<Record<string, ContainerStatus>>
// For each id: docker.getContainer(id).inspect()
//   → State.Status === 'running' ? 'running' : 'stopped'
//   → catch → 'unknown'
// Returns map of containerId → ContainerStatus
```

**`types.ts`** — add:
```ts
export type ContainerStatus = 'running' | 'stopped' | 'unknown'
```

**`ipcHandlers.ts`** — add handler:
```ts
ipcMain.handle('window:dep-containers-status', (_, containerIds: string[]) =>
  getDepContainersStatus(containerIds))
```

**`preload/index.ts`** — expose:
```ts
getDepContainersStatus: (ids: string[]) => Promise<Record<string, ContainerStatus>>
  → ipcRenderer.invoke('window:dep-containers-status', ids)
```

### UI: `WindowDetailPane.svelte`

**New state:**
```ts
depStatuses: Record<string, ContainerStatus> = {}
```

**Polling:**
- After `depContainers` loaded on mount: fetch statuses immediately
- Then poll every 5s via `setInterval` (same cadence as existing git/branch poll)
- `window.api.getDepContainersStatus(depContainers.map(d => d.container_id))`
- Skip if `depContainers.length === 0`
- Clear interval in `onDestroy`

**Dropdown option prefix** (unicode, since `<option>` doesn't support CSS color):
| Status | Prefix |
|--------|--------|
| `running` | `▶ ` |
| `stopped` | `■ ` |
| `unknown` | `? ` |

Example: `▶ postgres:latest` / `■ redis:7`

---

## Files Changed

| File | Change |
|------|--------|
| `src/main/dependencyService.ts` | Add `updateDependency()` |
| `src/main/containerStatusService.ts` | New — `getDepContainersStatus()` |
| `src/main/ipcHandlers.ts` | Add 2 handlers |
| `src/preload/index.ts` | Expose 2 new API methods |
| `src/renderer/src/types.ts` | Add `ContainerStatus` type |
| `src/renderer/src/components/DependenciesSection.svelte` | KV editor in add form + inline edit |
| `src/renderer/src/components/WindowDetailPane.svelte` | Status poll + dropdown prefix |

## Testing

- `dependencyService.test.ts` — unit test `updateDependency`
- `containerStatusService.test.ts` — unit test `getDepContainersStatus` (mock Docker inspect)
- `DependenciesSection.test.ts` — env var row add/remove/save/cancel flows
- `WindowDetailPane.test.ts` — status poll, dropdown option text with prefix
